import React from 'react';
import morphdom from 'morphdom';
import { renderMermaidASCII, renderMermaidSVG } from 'beautiful-mermaid';
import type { Part } from '@opencode-ai/sdk/v2';
import { cn, getRevealLabelKey } from '@/lib/utils';
import { useI18n } from '@/lib/i18n';
import { openExternalUrl } from '@/lib/url';
import { useOptionalThemeSystem } from '@/contexts/useThemeSystem';
import { getDefaultTheme } from '@/lib/theme/themes';
import type { Theme } from '@/types/theme';
import { openAppLinkWithConfirmation } from './appLinkConfirmation';
import { attachAppLinkInteractions } from './appLinkInteractions';
import type { ToolPopupContent } from './message/types';
import { MARKDOWN_POPUP_TOOL } from './message/types';
import { FadeInOnReveal } from './message/FadeInOnReveal';
import { useUIStore } from '@/stores/useUIStore';
import { useFileSearchStore } from '@/stores/useFileSearchStore';
import { useEffectiveDirectory, useHomeDirectory } from '@/hooks/useEffectiveDirectory';
import { useRuntimeAPIs } from '@/hooks/useRuntimeAPIs';
import { isBrowserClientRuntime, isDesktopLocalOriginActive, isDesktopShell, isVSCodeRuntime, revealDesktopPath } from '@/lib/desktop';
import { isMobileSurfaceRuntime } from '@/lib/runtimeSurface';
import { ensureOutsideFileGrantForDesktop } from '@/lib/outsideFileGrants';
import { getDirectoryForFilePath, isFilePathWithinDirectory } from '@/lib/path-utils';
import {
  getCachedMarkdownBlocks,
  renderMarkdownBlocks,
  renderMarkdownSync,
  type MarkdownImageMode,
} from './markdown/markdownCore';
import { ensureMarkdownShikiTheme } from './markdown/markdownTheme';
import { getMarkdownSyntaxVars } from './markdown/markdownSyntaxVars';
import {
  attachMarkdownInteractions,
  applyMarkdownCodeBlockWrapState,
  decorateMarkdown,
  getMarkdownCodeText,
  stabilizeMarkdownTableWidths,
  type DecorateContext,
  type DecorateLabels,
  type MermaidControlOptions,
  type MermaidRender,
} from './markdown/decorate';
import { findTextPosition } from './markdown/textPosition';
import { createMenuItem, createMenuSurface } from './markdown/menuSurface';
import { createMermaidViewerRegistry, MERMAID_BLOCK_SELECTOR, shouldRefreshMermaidViewers } from './markdown/mermaidViewer';
import {
  BLOCK_PATH_TOKEN_RE,
  HOME_ANCHORED_PATH_TOKEN_RE,
  WINDOWS_ABSOLUTE_PATH_TOKEN_RE,
  isLikelyFilePath,
  localPathFromFileUrl,
  resolveFileReference,
  type ParsedFileReference,
} from './fileReferenceParser';
import { lookupWorkspaceFileReference } from './fileReferenceLookup';
import { fileReferenceStat } from './fileReferenceStat';
import {
  FILE_LINK_ATTR,
  FILE_LINK_DIR_ATTR,
  FILE_LINK_PATH_ATTR,
  FILE_LINK_REF_ATTR,
  FILE_LINK_SELECTOR,
  hasFileLinkBudget,
} from './fileReferenceLink';
import { streamPerfCount, streamPerfObserve } from '@/stores/utils/streamDebug';
import { detachedMarkdownDomCache, type DetachedMarkdownDomKey } from './markdown/detachedMarkdownDomCache';
import { TimelineRevealGateContext } from './timelineRevealGate';
import { getRuntimeKey } from '@/lib/runtime-switch';

const useCurrentMermaidTheme = () => {
  const themeSystem = useOptionalThemeSystem();
  const fallbackLight = getDefaultTheme(false);
  const fallbackDark = getDefaultTheme(true);

  return themeSystem?.currentTheme
    ?? (typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
      ? fallbackDark
      : fallbackLight);
};

const useLinkInteractions = ({
  containerRef,
  enabled,
}: {
  containerRef: React.RefObject<HTMLDivElement | null>;
  enabled?: boolean;
}) => {
  React.useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    return attachAppLinkInteractions(container, {
      allowExternalHttp: enabled !== false,
      openAppLink: (href) => void openAppLinkWithConfirmation(href),
      openExternalHttp: (href) => void openExternalUrl(href),
    });
  }, [containerRef, enabled]);
};

const DEFAULT_MERMAID_CONTROLS: MermaidControlOptions = {
  download: true,
  copy: true,
  showPanZoomControls: true,
};
const DEFAULT_MERMAID_FULLSCREEN_ENABLED = true;

const stripLeadingFrontmatter = (markdown: string): string => {
  const frontmatterMatch = markdown.match(
    /^(?:\uFEFF)?(---|\+\+\+)[^\S\r\n]*\r?\n[\s\S]*?\r?\n\1[^\S\r\n]*(?:\r?\n|$)/,
  );

  if (!frontmatterMatch) {
    return markdown;
  }

  return markdown.slice(frontmatterMatch[0].length);
};

export type MarkdownVariant = 'assistant' | 'tool' | 'reasoning';

interface MarkdownRendererProps {
  content: string;
  part?: Part;
  messageId: string;
  isAnimated?: boolean;
  skipFadeIn?: boolean;
  className?: string;
  isStreaming?: boolean;
  disableStreamAnimation?: boolean;
  variant?: MarkdownVariant;
  onShowPopup?: (content: ToolPopupContent) => void;
  enableFileReferences?: boolean;
}

const FILE_LINK_MENU_ATTR = 'data-openchamber-file-link-menu';
const BLOCK_PATH_TOKEN_ATTR = 'data-openchamber-block-path-token';
const BLOCK_PATH_TOKEN_SELECTOR = `[${BLOCK_PATH_TOKEN_ATTR}]`;
const CODE_BLOCK_PATH_SCANNED_ATTR = 'data-openchamber-block-paths-scanned';
// Matches `path[:line[:col]]` or `path:start-end` inside shell/grep-style
// output. The regex is defined in `./fileReferenceParser`; the inline-code
// pipeline reads full text content rather than using this regex.
const MAX_BLOCK_CODE_SCAN_LENGTH = 200_000;
// Budget for the links one rendered message receives. It is spent on links that
// were actually granted, never on the path-shaped tokens a message holds: log
// fragments and dotted identifiers outnumber real references by far.
const FILE_REFERENCE_LINK_LIMIT = 80;
const VSCODE_FILE_REFERENCE_LINK_LIMIT = 40;
const FILE_REFERENCE_ANNOTATION_DELAY_MS = 160;

const getFileReferenceLinkLimit = (): number => (
  isVSCodeRuntime() ? VSCODE_FILE_REFERENCE_LINK_LIMIT : FILE_REFERENCE_LINK_LIMIT
);

// Runs both path matchers over a text run and de-overlaps the results. The
// block matcher requires a file extension; the Windows matcher covers
// extension-less absolute directories. When both match the same span, the
// earlier (and, on a tie, longer) match wins.
const collectPathMatches = (text: string): Array<{ start: number; end: number; raw: string }> => {
  const found: Array<{ start: number; end: number; raw: string }> = [];
  for (const pattern of [BLOCK_PATH_TOKEN_RE, WINDOWS_ABSOLUTE_PATH_TOKEN_RE, HOME_ANCHORED_PATH_TOKEN_RE]) {
    pattern.lastIndex = 0;
    let match = pattern.exec(text);
    while (match) {
      const raw = match[0];
      if (raw && isLikelyFilePath(raw)) {
        found.push({ start: match.index, end: match.index + raw.length, raw });
      }
      match = pattern.exec(text);
    }
  }

  found.sort((left, right) => left.start - right.start || right.end - left.end);
  const merged: Array<{ start: number; end: number; raw: string }> = [];
  for (const candidate of found) {
    const previous = merged[merged.length - 1];
    if (previous && candidate.start < previous.end) {
      continue;
    }
    merged.push(candidate);
  }
  return merged;
};

const unwrapBlockCodePathTokens = (container: HTMLElement): void => {
  const tokenSpans = container.querySelectorAll<HTMLElement>(BLOCK_PATH_TOKEN_SELECTOR);
  for (const span of Array.from(tokenSpans)) {
    span.replaceWith(container.ownerDocument.createTextNode(span.textContent ?? ''));
  }

  const scannedBlocks = container.querySelectorAll<HTMLElement>(`code[${CODE_BLOCK_PATH_SCANNED_ATTR}]`);
  for (const codeBlock of Array.from(scannedBlocks)) {
    codeBlock.removeAttribute(CODE_BLOCK_PATH_SCANNED_ATTR);
    codeBlock.normalize();
  }
};

const extractPathCandidateFromElement = (element: HTMLElement): string => {
  if (element.tagName.toLowerCase() === 'a') {
    const href = element.getAttribute('href')?.trim();
    const fileUrlPath = href ? localPathFromFileUrl(href) : null;
    if (fileUrlPath) {
      return fileUrlPath;
    }
    if (href && isLikelyFilePath(href)) {
      return href;
    }
  }

  return (element.textContent || '').trim();
};

// Walks text nodes inside `<pre><code>` subtrees and wraps any substring that
// looks like a `path[:line[:col]]` reference in a span carrying
// `data-openchamber-block-path-token`. `annotateFileLinks` then promotes those
// spans into clickable file links via the same existing pipeline used for
// inline code (parseFileReference → fileReferenceStat → openFileReference).
//
// Idempotent: each `<code>` node is marked with
// `data-openchamber-block-paths-scanned` once processed so the walk is not
// repeated on the same element. When the renderer replaces the `<code>` subtree
// (e.g. on content change during streaming), the new element lacks the marker and
// will be rescanned on the next mutation-observer callback.
const wrapBlockCodePathTokens = (container: HTMLElement): void => {
  const codeBlocks = container.querySelectorAll<HTMLElement>('pre code');
  if (codeBlocks.length === 0) {
    return;
  }

  const doc = container.ownerDocument;
  if (!doc) {
    return;
  }

  for (const codeBlock of Array.from(codeBlocks)) {
    if (codeBlock.getAttribute(CODE_BLOCK_PATH_SCANNED_ATTR) === 'true') {
      continue;
    }

    // Skip absurdly large code blocks to keep DOM work bounded.
    if ((codeBlock.textContent ?? '').length > MAX_BLOCK_CODE_SCAN_LENGTH) {
      codeBlock.setAttribute(CODE_BLOCK_PATH_SCANNED_ATTR, 'true');
      continue;
    }

    const walker = doc.createTreeWalker(codeBlock, NodeFilter.SHOW_TEXT);
    const textNodes: Text[] = [];
    let currentNode = walker.nextNode();
    while (currentNode) {
      const textNode = currentNode as Text;
      if (!textNode.parentElement?.closest('[data-md-code-line-number]')) {
        textNodes.push(textNode);
      }
      currentNode = walker.nextNode();
    }

    const fullText = getMarkdownCodeText(codeBlock);
    if (!fullText.includes('.') && !fullText.includes('\\')) {
      codeBlock.setAttribute(CODE_BLOCK_PATH_SCANNED_ATTR, 'true');
      continue;
    }

    const matches = collectPathMatches(fullText);

    for (const { start, end, raw } of matches.reverse()) {
      const startPosition = findTextPosition(textNodes, start, 'right');
      const endPosition = findTextPosition(textNodes, end, 'left');
      if (!startPosition || !endPosition) {
        continue;
      }

      const range = doc.createRange();
      range.setStart(startPosition.node, startPosition.offset);
      range.setEnd(endPosition.node, endPosition.offset);

      const span = doc.createElement('span');
      span.setAttribute(BLOCK_PATH_TOKEN_ATTR, 'true');
      span.textContent = raw;

      range.deleteContents();
      range.insertNode(span);
    }

    codeBlock.setAttribute(CODE_BLOCK_PATH_SCANNED_ATTR, 'true');
  }
};

// Bare paths written in prose (outside inline code, links, or fenced blocks)
// never reach the file-link pipeline, so they render as inert text the user has
// to copy. Wrap `path[:line[:col]]`-looking substrings found in ordinary text
// nodes in the same `data-openchamber-block-path-token` span used for code
// blocks, so the existing annotate → stat → open flow applies unchanged.
// Idempotent: wrapped spans carry the token attribute and are skipped on later
// passes; the existence probe still decides whether a candidate becomes a link.
const PROSE_PATH_EXCLUDE_SELECTOR = [
  'a',
  'code',
  'pre',
  'summary',
  'button',
  'textarea',
  'script',
  'style',
  `[${BLOCK_PATH_TOKEN_ATTR}]`,
  FILE_LINK_SELECTOR,
].join(',');

const wrapProsePathTokens = (container: HTMLElement): void => {
  const doc = container.ownerDocument;
  if (!doc) {
    return;
  }

  const walker = doc.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  let node = walker.nextNode();
  while (node) {
    // SAFETY: the walker is bounded to NodeFilter.SHOW_TEXT, so every node it
    // yields is a Text node.
    const textNode = node as Text;
    const parent = textNode.parentElement;
    const value = textNode.data;
    if (parent && value && (value.includes('.') || value.includes('\\')) && value.length <= MAX_BLOCK_CODE_SCAN_LENGTH
      && !parent.closest(PROSE_PATH_EXCLUDE_SELECTOR)) {
      textNodes.push(textNode);
    }
    node = walker.nextNode();
  }

  for (const textNode of textNodes) {
    const matches = collectPathMatches(textNode.data);

    for (const { start, end, raw } of matches.reverse()) {
      const tokenNode = textNode.splitText(start);
      tokenNode.splitText(end - start);
      const span = doc.createElement('span');
      span.setAttribute(BLOCK_PATH_TOKEN_ATTR, 'true');
      span.textContent = raw;
      tokenNode.replaceWith(span);
    }
  }
};

const getResolvedReference = (
  rawValue: string,
  effectiveDirectory: string,
  homeDirectory: string,
  storedPath?: string | null,
): (ParsedFileReference & { resolvedPath: string }) | null => resolveFileReference(rawValue, {
  directory: effectiveDirectory,
  homeDirectory,
  storedPath,
});

const getContextDirectory = (effectiveDirectory: string, resolvedPath: string): string => {
  return effectiveDirectory || getDirectoryForFilePath(effectiveDirectory, resolvedPath);
};

const useFileReferenceInteractions = ({
  containerRef,
  effectiveDirectory,
  homeDirectory,
  enabled,
}: {
  containerRef: React.RefObject<HTMLDivElement | null>;
  effectiveDirectory: string;
  homeDirectory: string;
  enabled: boolean;
}) => {
  // Runtime APIs are read when a file link is activated, never during render:
  // painting the transcript must not depend on the host runtime, and a message
  // must stay renderable in a surface without runtime providers.
  const runtimeApis = useRuntimeAPIs();
  const searchFiles = useFileSearchStore((state) => state.searchFiles);
  const annotationDebounceRef = React.useRef<number | null>(null);

  React.useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    // Wait for the real directory: annotating against an empty/fallback
    // directory issues stat probes under the wrong cache key (and the wrong
    // server directory), and the pass reruns anyway once the directory
    // resolves — every link ended up verified twice.
    if (enabled && !effectiveDirectory) {
      return;
    }
    let cancelled = false;
    const fileReferenceLinkLimit = getFileReferenceLinkLimit();
    // On mobile surfaces, file-reference highlighting is disabled entirely — not
    // just visually. The annotation pass is what issues the filesystem `stat`
    // probes (fileReferenceStat → /api/fs/stat), so skipping it here guarantees
    // no probe requests are ever sent from a mobile runtime.
    const fileReferencesEnabled = enabled && !isMobileSurfaceRuntime();

    const clearFileLinkAttributes = (candidate: HTMLElement) => {
      candidate.removeAttribute(FILE_LINK_ATTR);
      candidate.removeAttribute(FILE_LINK_REF_ATTR);
      candidate.removeAttribute(FILE_LINK_PATH_ATTR);
      candidate.removeAttribute(FILE_LINK_DIR_ATTR);
      const title = candidate.getAttribute('title');
      if (title === 'Open file' || title === 'Open folder') {
        candidate.removeAttribute('title');
      }
      if (candidate.tagName.toLowerCase() !== 'a') {
        candidate.removeAttribute('role');
        candidate.removeAttribute('tabindex');
      }
    };

    const clearAnnotatedFileLinks = () => {
      const annotated = container.querySelectorAll<HTMLElement>(FILE_LINK_SELECTOR);
      for (const candidate of Array.from(annotated)) {
        clearFileLinkAttributes(candidate);
      }
      for (const element of Array.from(container.querySelectorAll<HTMLElement>('[data-openchamber-external-link]'))) {
        element.removeAttribute('data-openchamber-external-link');
        const currentTitle = element.getAttribute('title');
        if (currentTitle && /^https?:\/\//.test(currentTitle)) {
          element.removeAttribute('title');
        }
      }
      unwrapBlockCodePathTokens(container);
    };

    if (!fileReferencesEnabled) {
      clearAnnotatedFileLinks();
      return;
    }

    const scheduleAnnotation = (delayMs = 0) => {
      if (annotationDebounceRef.current !== null && typeof window !== 'undefined') {
        window.clearTimeout(annotationDebounceRef.current);
      }
      if (typeof window === 'undefined') {
        annotateFileLinks();
        return;
      }
      annotationDebounceRef.current = window.setTimeout(() => {
        annotationDebounceRef.current = null;
        window.requestAnimationFrame(() => {
          if (!cancelled) {
            annotateFileLinks();
          }
        });
      }, delayMs);
    };

    const annotateFileLinks = () => {
      annotationWriteDepth += 1;
      try {
        annotateFileLinksInner();
      } finally {
        // Let the mutation events from our own writes flush before the
        // observer starts listening for real content changes again.
        queueMicrotask(() => {
          annotationWriteDepth -= 1;
        });
      }
    };

    const annotateFileLinksInner = () => {
      if (fileReferencesEnabled) {
        wrapBlockCodePathTokens(container);
        wrapProsePathTokens(container);
      }
      const candidates = container.querySelectorAll<HTMLElement>(
        `[data-markdown="inline-code"], a, ${BLOCK_PATH_TOKEN_SELECTOR}`,
      );

      for (const candidate of Array.from(candidates)) {
        const rawCandidate = extractPathCandidateFromElement(candidate);
        // A link whose text did not change stays granted: re-probing it on
        // every pass kept the stat queue and the file search busy, and a link
        // dropped by a pass that ran out of budget did not always come back.
        if (candidate.getAttribute(FILE_LINK_ATTR) === 'true'
          && candidate.getAttribute(FILE_LINK_REF_ATTR) === rawCandidate) {
          continue;
        }

        const resolved = getResolvedReference(rawCandidate, effectiveDirectory, homeDirectory);

        if (!resolved) {
          clearFileLinkAttributes(candidate);
          continue;
        }

        const canGrantOutsideFile = isDesktopShell()
          && isDesktopLocalOriginActive()
          && !isFilePathWithinDirectory(resolved.resolvedPath, effectiveDirectory);
        const statPromise = canGrantOutsideFile
          ? Promise.resolve({ exists: true, isDirectory: false })
          : fileReferenceStat(resolved.resolvedPath, effectiveDirectory);

        void statPromise.then(async ({ exists, isDirectory }) => {
          if (cancelled || !container.contains(candidate)) {
            return;
          }

          // A reference the direct probe missed was written from another root
          // (a repository inside the opened folder, or the folder inside the
          // opened repository), so the shared file search locates it.
          let targetPath = resolved.resolvedPath;
          let targetIsDirectory = isDirectory;
          if (!exists) {
            const located = await lookupWorkspaceFileReference(resolved.resolvedPath, effectiveDirectory, searchFiles);
            if (cancelled || !container.contains(candidate)) {
              return;
            }
            if (!located) {
              // The reference names nothing this workspace can reach; a link
              // granted for an earlier text of this element no longer holds.
              clearFileLinkAttributes(candidate);
              return;
            }
            targetPath = located;
            targetIsDirectory = false;
          }

          const latestRawCandidate = extractPathCandidateFromElement(candidate);
          const latestResolved = getResolvedReference(latestRawCandidate, effectiveDirectory, homeDirectory);
          if (!latestResolved || latestResolved.resolvedPath !== resolved.resolvedPath) {
            clearFileLinkAttributes(candidate);
            return;
          }

          // The budget is spent here, on a link that exists, so tokens that
          // only look like paths cannot use it up before the real references.
          // Links granted earlier keep their attributes either way.
          if (candidate.getAttribute(FILE_LINK_ATTR) !== 'true'
            && !hasFileLinkBudget(container, fileReferenceLinkLimit)) {
            return;
          }

          candidate.setAttribute(FILE_LINK_ATTR, 'true');
          candidate.setAttribute(FILE_LINK_REF_ATTR, latestRawCandidate);
          candidate.setAttribute(FILE_LINK_PATH_ATTR, targetPath);
          if (targetIsDirectory) {
            candidate.setAttribute(FILE_LINK_DIR_ATTR, 'true');
            candidate.setAttribute('title', 'Open folder');
          } else {
            candidate.setAttribute('title', 'Open file');
          }
          if (candidate.tagName.toLowerCase() !== 'a') {
            candidate.setAttribute('role', 'button');
            candidate.setAttribute('tabindex', '0');
          }
        });
      }

      // URLs written inside inline code stay `<code>` (markdown does not
      // autolink code), so they are not clickable. Mark URL-only code spans so
      // the shared link handler can open them externally; everything else is
      // left untouched.
      for (const element of Array.from(container.querySelectorAll<HTMLElement>('[data-markdown="inline-code"]'))) {
        const value = (element.textContent ?? '').trim();
        const isUrlOnly = /^https?:\/\/\S+$/.test(value)
          && element.getAttribute(FILE_LINK_ATTR) !== 'true';
        if (isUrlOnly) {
          element.setAttribute('data-openchamber-external-link', value);
          element.setAttribute('title', value);
        } else {
          element.removeAttribute('data-openchamber-external-link');
          const currentTitle = element.getAttribute('title');
          if (currentTitle && /^https?:\/\//.test(currentTitle)) {
            element.removeAttribute('title');
          }
        }
      }
    };

    const openFileReference = async (sourceElement: HTMLElement) => {
      const raw = sourceElement.getAttribute(FILE_LINK_REF_ATTR) || extractPathCandidateFromElement(sourceElement);
      const storedPath = sourceElement.getAttribute(FILE_LINK_PATH_ATTR);
      const resolved = getResolvedReference(raw, effectiveDirectory, homeDirectory, storedPath);
      if (!resolved) {
        return;
      }

      if (sourceElement.getAttribute(FILE_LINK_DIR_ATTR) === 'true') {
        const revealPath = runtimeApis.files?.revealPath;
        if (revealPath) {
          const result = await revealPath(resolved.resolvedPath).catch(() => null);
          if (result?.success) {
            return;
          }
        }
        await revealDesktopPath(resolved.resolvedPath);
        return;
      }

      const contextDirectory = getContextDirectory(effectiveDirectory, resolved.resolvedPath);
      const { editor } = runtimeApis;
      if (runtimeApis.runtime.isVSCode && editor) {
        void editor.openFile(
          resolved.resolvedPath,
          Number.isFinite(resolved.line ?? Number.NaN)
            ? Math.max(1, Math.trunc(resolved.line as number))
            : undefined,
          Number.isFinite(resolved.column ?? Number.NaN)
            ? Math.max(1, Math.trunc(resolved.column as number))
            : undefined,
        );
        return;
      }

      if (!isFilePathWithinDirectory(resolved.resolvedPath, effectiveDirectory)) {
        await ensureOutsideFileGrantForDesktop(resolved.resolvedPath, effectiveDirectory);
      }

      const uiStore = useUIStore.getState();
      if (Number.isFinite(resolved.line ?? Number.NaN)) {
        uiStore.openContextFileAtLine(
          contextDirectory,
          resolved.resolvedPath,
          Math.max(1, Math.trunc(resolved.line as number)),
          Number.isFinite(resolved.column ?? Number.NaN)
            ? Math.max(1, Math.trunc(resolved.column as number))
            : 1,
        );
      } else {
        uiStore.openContextFile(contextDirectory, resolved.resolvedPath);
      }
    };

    const handleClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }

      const fileRefElement = target.closest(FILE_LINK_SELECTOR);
      if (!(fileRefElement instanceof HTMLElement)) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      void openFileReference(fileRefElement);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Enter' && event.key !== ' ') {
        return;
      }

      const target = event.target;
      if (!(target instanceof HTMLElement) || target.getAttribute(FILE_LINK_ATTR) !== 'true') {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      void openFileReference(target);
    };

    scheduleAnnotation(FILE_REFERENCE_ANNOTATION_DELAY_MS);

    // Our own annotation writes (path-token wrapping, attribute updates) fire
    // childList mutations too; observing them re-ran the whole pass — every
    // link was scanned and verified twice per render.
    let annotationWriteDepth = 0;
    const observer = new MutationObserver(() => {
      if (annotationWriteDepth > 0) return;
      scheduleAnnotation(FILE_REFERENCE_ANNOTATION_DELAY_MS);
    });
    observer.observe(container, {
      childList: true,
      subtree: true,
    });

    container.addEventListener('click', handleClick);
    container.addEventListener('keydown', handleKeyDown);

    return () => {
      cancelled = true;
      if (annotationDebounceRef.current !== null && typeof window !== 'undefined') {
        window.clearTimeout(annotationDebounceRef.current);
      }
      annotationDebounceRef.current = null;
      observer.disconnect();
      container.removeEventListener('click', handleClick);
      container.removeEventListener('keydown', handleKeyDown);
    };
  }, [containerRef, runtimeApis, searchFiles, effectiveDirectory, homeDirectory, enabled]);
};

/**
 * Right-click menu for file links in the transcript: the same "open in the OS
 * file manager" action the files tree exposes, without leaving the chat. The
 * menu lives in the document body so it is never clipped by the scroll box the
 * transcript renders the link inside.
 */
const useFileLinkContextMenu = ({
  containerRef,
  revealLabel,
  getRevealAction,
}: {
  containerRef: React.RefObject<HTMLDivElement | null>;
  revealLabel: string;
  /**
   * Resolves the reveal action on demand. Reading it during render would touch
   * runtime APIs that hosts without a filesystem do not provide, so the caller
   * only hands over a resolver and the menu asks when it actually opens.
   */
  getRevealAction?: (path: string) => (() => void) | null;
}) => {
  React.useEffect(() => {
    const container = containerRef.current;
    if (!container || !getRevealAction) {
      return;
    }

    const doc = container.ownerDocument;
    let menu: HTMLDivElement | null = null;
    let detachMenuListeners: (() => void) | null = null;

    const closeMenu = () => {
      detachMenuListeners?.();
      detachMenuListeners = null;
      menu?.remove();
      menu = null;
    };

    const openMenu = (x: number, y: number, path: string, reveal: () => void) => {
      closeMenu();
      const surface = createMenuSurface();
      surface.setAttribute(FILE_LINK_MENU_ATTR, 'true');
      surface.classList.remove('hidden');
      surface.style.position = 'fixed';
      surface.style.left = `${x}px`;
      surface.style.top = `${y}px`;
      // Above the context panel and the transcript's sticky headers.
      surface.style.zIndex = '60';

      const item = createMenuItem(revealLabel, null);
      item.addEventListener('click', () => {
        closeMenu();
        reveal();
      });
      surface.appendChild(item);
      doc.body.appendChild(surface);
      menu = surface;

      // The sidebar and the VS Code webview are narrow: keep the menu inside
      // the viewport instead of letting it overflow off the right/bottom edge.
      const rect = surface.getBoundingClientRect();
      const maxLeft = Math.max(0, doc.documentElement.clientWidth - rect.width);
      const maxTop = Math.max(0, doc.documentElement.clientHeight - rect.height);
      surface.style.left = `${Math.min(x, maxLeft)}px`;
      surface.style.top = `${Math.min(y, maxTop)}px`;

      const handlePointerDown = (event: MouseEvent) => {
        if (event.target instanceof Node && menu?.contains(event.target)) {
          return;
        }
        closeMenu();
      };
      const handleKeyDown = (event: KeyboardEvent) => {
        if (event.key === 'Escape') {
          closeMenu();
        }
      };
      const handleViewportChange = () => closeMenu();

      doc.addEventListener('mousedown', handlePointerDown, true);
      doc.addEventListener('keydown', handleKeyDown, true);
      doc.defaultView?.addEventListener('scroll', handleViewportChange, true);
      doc.defaultView?.addEventListener('resize', handleViewportChange, true);
      detachMenuListeners = () => {
        doc.removeEventListener('mousedown', handlePointerDown, true);
        doc.removeEventListener('keydown', handleKeyDown, true);
        doc.defaultView?.removeEventListener('scroll', handleViewportChange, true);
        doc.defaultView?.removeEventListener('resize', handleViewportChange, true);
      };
    };

    const handleContextMenu = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }

      const link = target.closest(FILE_LINK_SELECTOR);
      if (!(link instanceof HTMLElement)) {
        closeMenu();
        return;
      }

      const path = link.getAttribute(FILE_LINK_PATH_ATTR);
      if (!path) {
        return;
      }

      const reveal = getRevealAction(path);
      if (!reveal) {
        return;
      }

      event.preventDefault();
      openMenu(event.clientX, event.clientY, path, reveal);
    };

    container.addEventListener('contextmenu', handleContextMenu);
    return () => {
      container.removeEventListener('contextmenu', handleContextMenu);
      closeMenu();
    };
  }, [containerRef, getRevealAction, revealLabel]);
};

const useMermaidInlineInteractions = ({
  containerRef,
  onShowPopup,
  enableFullscreen,
  enablePanZoom,
  allowMermaidWheelEvents,
}: {
  containerRef: React.RefObject<HTMLDivElement | null>;
  onShowPopup?: (content: ToolPopupContent) => void;
  enableFullscreen?: boolean;
  enablePanZoom?: boolean;
  allowMermaidWheelEvents?: boolean;
}) => {
  React.useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const handleMermaidClick = (event: MouseEvent) => {
      if (!enableFullscreen || !onShowPopup) {
        return;
      }

      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }

      if (target.closest('button, a, [role="button"]')) {
        return;
      }

      const block = target.closest(MERMAID_BLOCK_SELECTOR);
      if (!block) {
        return;
      }

      if (block instanceof HTMLElement && block.hasAttribute('data-mermaid-suppress-click')) {
        block.removeAttribute('data-mermaid-suppress-click');
        return;
      }

      const renderedBlocks = Array.from(container.querySelectorAll<HTMLElement>(MERMAID_BLOCK_SELECTOR));
      const blockIndex = renderedBlocks.indexOf(block as HTMLElement);
      if (blockIndex < 0) {
        return;
      }

      const source = block instanceof HTMLElement ? block.getAttribute('data-md-source') : null;
      if (!source || source.trim().length === 0) {
        return;
      }

      const filename = `Diagram ${blockIndex + 1}`;
      onShowPopup({
        open: true,
        title: filename,
        content: '',
        metadata: {
          tool: 'mermaid-preview',
          filename,
        },
        mermaid: {
          url: `data:text/plain;charset=utf-8,${encodeURIComponent(source)}`,
          source,
          filename,
        },
      });
    };

    const handleInlineWheel = (event: WheelEvent) => {
      if (allowMermaidWheelEvents || ((event.ctrlKey || event.metaKey) && enablePanZoom)) {
        return;
      }

      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }

      const block = target.closest(MERMAID_BLOCK_SELECTOR);
      if (!block) {
        return;
      }

      // Keep regular page scroll while preventing Streamdown inline wheel-zoom handlers.
      event.stopPropagation();
    };

    container.addEventListener('click', handleMermaidClick);
    container.addEventListener('wheel', handleInlineWheel, { capture: true, passive: true });

    return () => {
      container.removeEventListener('click', handleMermaidClick);
      container.removeEventListener('wheel', handleInlineWheel, true);
    };
  }, [allowMermaidWheelEvents, containerRef, enableFullscreen, enablePanZoom, onShowPopup]);
};

// ---------------------------------------------------------------------------
// Rendering core: marked -> math -> shiki -> sanitize -> decorate -> morphdom
// ---------------------------------------------------------------------------

// Mermaid layout is expensive; `decorate` would otherwise re-render every
// diagram on every paced-stream step (~40/sec). Memoize by theme+mode+source
// so a stable diagram is laid out once and served from cache thereafter.
const MERMAID_RENDER_CACHE = new Map<string, MermaidRender>();
const MERMAID_RENDER_CACHE_MAX = 100;
const MARKDOWN_DECORATION_ID_ATTR = 'data-md-decoration-id';

// True when the container already holds exactly these settled blocks with the
// current decoration. The first paint of a remounted message is served from
// the block cache; when that paint is already final, the async render would
// only parse, highlight, sanitize, and morph the same HTML into place again.
const domMatchesRenderedBlocks = (
  target: HTMLElement,
  blocks: ReadonlyArray<{ id: string }>,
  decorationId: string,
): boolean => {
  const children = target.children;
  if (children.length !== blocks.length) return false;
  for (let index = 0; index < blocks.length; index += 1) {
    const child = children[index];
    if (
      !child
      || child.getAttribute('data-md-id') !== blocks[index]?.id
      || child.getAttribute(MARKDOWN_DECORATION_ID_ATTR) !== decorationId
    ) {
      return false;
    }
  }
  return true;
};
const MARKDOWN_DECORATION_IDS = new WeakMap<DecorateContext, string>();
let nextMarkdownDecorationId = 0;
const MARKDOWN_DOM_CACHE_MAX_SOURCE_CHARS = 200_000;

const getMarkdownDecorationId = (ctx: DecorateContext): string => {
  const existing = MARKDOWN_DECORATION_IDS.get(ctx);
  if (existing) return existing;
  const id = `decoration-${nextMarkdownDecorationId}`;
  nextMarkdownDecorationId += 1;
  MARKDOWN_DECORATION_IDS.set(ctx, id);
  return id;
};

const cachedMermaidRender = (key: string, compute: () => MermaidRender): MermaidRender => {
  const existing = MERMAID_RENDER_CACHE.get(key);
  if (existing) {
    MERMAID_RENDER_CACHE.delete(key);
    MERMAID_RENDER_CACHE.set(key, existing);
    return existing;
  }
  const value = compute();
  MERMAID_RENDER_CACHE.set(key, value);
  if (MERMAID_RENDER_CACHE.size > MERMAID_RENDER_CACHE_MAX) {
    const oldest = MERMAID_RENDER_CACHE.keys().next().value;
    if (oldest) MERMAID_RENDER_CACHE.delete(oldest);
  }
  return value;
};

const mermaidColorsFromTheme = (theme: Theme) => ({
  bg: theme.colors.surface.elevated,
  fg: theme.colors.surface.foreground,
  line: theme.colors.interactive.border,
  accent: theme.colors.primary.base,
  muted: theme.colors.surface.mutedForeground,
  surface: theme.colors.surface.muted,
  border: theme.colors.interactive.border,
  transparent: true,
  font: 'system-ui, sans-serif',
});

const useDecorateContext = (
  currentTheme: Theme,
  deferCodeLineNumberSync: boolean,
  onPreviewLoopback?: (url: string) => void,
  mermaidControls: MermaidControlOptions = DEFAULT_MERMAID_CONTROLS,
  onExpandTable?: (markdown: string) => void,
): DecorateContext => {
  const { t } = useI18n();
  const labels: DecorateLabels = React.useMemo(() => ({
    copy: t('markdownRenderer.code.actions.copyTitle'),
    copied: t('markdownRenderer.code.actions.copiedTitle'),
    enableCodeWrap: t('markdownRenderer.code.actions.enableWrapTitle'),
    disableCodeWrap: t('markdownRenderer.code.actions.disableWrapTitle'),
    copyTable: t('markdownRenderer.table.actions.copyTitle'),
    downloadTable: t('markdownRenderer.table.actions.downloadTitle'),
    expandTable: t('markdownRenderer.table.actions.expandTitle'),
    copyDiagram: t('markdownRenderer.mermaid.actions.copySourceTitle'),
    downloadDiagram: t('markdownRenderer.mermaid.actions.downloadSvgTitle'),
    zoomInDiagram: t('markdownRenderer.mermaid.actions.zoomInTitle'),
    zoomOutDiagram: t('markdownRenderer.mermaid.actions.zoomOutTitle'),
    resetDiagramView: t('markdownRenderer.mermaid.actions.resetViewTitle'),
    previewLabel: t('terminalView.preview.open'),
    previewTitle: t('terminalView.preview.openTitle'),
  }), [t]);

  const codeBlockLineWrap = useUIStore((state) => state.codeBlockLineWrap);
  const setCodeBlockLineWrap = useUIStore((state) => state.setCodeBlockLineWrap);
  const toggleCodeBlockLineWrap = React.useCallback(() => {
    setCodeBlockLineWrap(!useUIStore.getState().codeBlockLineWrap);
  }, [setCodeBlockLineWrap]);

  return React.useMemo<DecorateContext>(() => {
    const colors = mermaidColorsFromTheme(currentTheme);
    const mode = useUIStore.getState().mermaidRenderingMode;
    const themeId = currentTheme.metadata?.id ?? 'theme';
    const renderMermaid = (source: string): MermaidRender =>
      cachedMermaidRender(`${themeId}:${mode}:${source}`, () => {
        try {
          if (mode === 'ascii') return { ascii: renderMermaidASCII(source) };
          return { svg: renderMermaidSVG(source, colors) };
        } catch {
          return {};
        }
      });
    return { labels, mermaidControls, codeBlockLineWrap, deferCodeLineNumberSync, onToggleCodeBlockLineWrap: toggleCodeBlockLineWrap, renderMermaid, onPreviewLoopback, onExpandTable };
  }, [currentTheme, labels, mermaidControls, codeBlockLineWrap, deferCodeLineNumberSync, toggleCodeBlockLineWrap, onPreviewLoopback, onExpandTable]);
};

// Runs the async render pipeline into the container and keeps a stable
// delegated interaction listener attached.
const useMorphdomMarkdown = ({
  containerRef,
  text,
  streaming,
  imageMode = 'inline',
  syntaxVars,
  ctx,
  domCacheKey,
  tableLayoutSettled,
}: {
  containerRef: React.RefObject<HTMLDivElement | null>;
  text: string;
  streaming: boolean;
  imageMode?: MarkdownImageMode;
  syntaxVars: Record<string, string>;
  ctx: DecorateContext;
  domCacheKey?: DetachedMarkdownDomKey | null;
  tableLayoutSettled: boolean;
}) => {
  React.useEffect(() => {
    ensureMarkdownShikiTheme();
  }, []);

  const mermaidViewerRef = React.useRef<ReturnType<typeof createMermaidViewerRegistry> | null>(null);
  const renderRevisionRef = React.useRef(0);
  const tableLayoutFrameRef = React.useRef<number | null>(null);
  // A provisional first paint (blocks not in the settled cache) holds the
  // timeline reveal until the async render lands, so the session opens with
  // final code highlighting instead of a visible restyle.
  const revealGate = React.useContext(TimelineRevealGateContext);
  const releaseRevealHoldRef = React.useRef<(() => void) | null>(null);
  const releaseRevealHold = React.useCallback(() => {
    releaseRevealHoldRef.current?.();
    releaseRevealHoldRef.current = null;
  }, []);
  React.useEffect(() => releaseRevealHold, [releaseRevealHold]);
  // Only DOM that was actually restored or completed by the async pipeline is
  // eligible for capture. A fallback from an earlier content revision is not.
  const mountedDomRef = React.useRef<{
    key: DetachedMarkdownDomKey;
    copiedLabel: string;
  } | null>(null);
  const refreshMermaidViewers = React.useCallback(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    if (!mermaidViewerRef.current) {
      if (!shouldRefreshMermaidViewers(container)) {
        return;
      }
      mermaidViewerRef.current = createMermaidViewerRegistry(container);
      return;
    }
    mermaidViewerRef.current.refresh();
  }, [containerRef]);
  const scheduleTableLayout = React.useCallback(() => {
    if (!tableLayoutSettled) return;
    const previousFrame = tableLayoutFrameRef.current;
    if (previousFrame !== null) window.cancelAnimationFrame(previousFrame);
    const renderRevision = renderRevisionRef.current;
    const frame = window.requestAnimationFrame(() => {
      if (tableLayoutFrameRef.current !== frame) return;
      tableLayoutFrameRef.current = null;
      if (renderRevisionRef.current !== renderRevision) return;
      const container = containerRef.current;
      const target = container?.querySelector<HTMLElement>('[data-markdown-content]') ?? container;
      if (target) stabilizeMarkdownTableWidths(target);
    });
    tableLayoutFrameRef.current = frame;
  }, [containerRef, tableLayoutSettled]);

  React.useEffect(() => () => {
    const frame = tableLayoutFrameRef.current;
    if (frame === null) return;
    window.cancelAnimationFrame(frame);
    tableLayoutFrameRef.current = null;
  }, []);

  React.useLayoutEffect(() => {
    renderRevisionRef.current += 1;
    mountedDomRef.current = null;
  }, [ctx, imageMode, streaming, text]);

  React.useLayoutEffect(() => {
    if (!domCacheKey) return;
    const container = containerRef.current;
    const target = container?.querySelector<HTMLElement>('[data-markdown-content]') ?? container;
    if (!target || target.childNodes.length > 0) return;

    const cached = detachedMarkdownDomCache.take(domCacheKey);
    if (cached) {
      target.appendChild(cached);
      const decorationId = getMarkdownDecorationId(ctx);
      for (const block of Array.from(target.children)) {
        block.setAttribute(MARKDOWN_DECORATION_ID_ATTR, decorationId);
      }
      for (const [key, value] of Object.entries(syntaxVars)) target.style.setProperty(key, value);
      applyMarkdownCodeBlockWrapState(target, ctx.codeBlockLineWrap, ctx.labels);
      mountedDomRef.current = {
        key: domCacheKey,
        copiedLabel: ctx.labels.copied,
      };
      streamPerfCount('ui.markdown_renderer.dom_cache.hit');
    }
  }, [containerRef, ctx, domCacheKey, syntaxVars, text.length]);

  // Restoration follows the cache identity above, but capture must only happen
  // when this renderer lifecycle ends. Combining both in one keyed effect would
  // detach the live DOM on ordinary content, theme, or locale updates.
  React.useLayoutEffect(() => {
    const container = containerRef.current;
    const target = container?.querySelector<HTMLElement>('[data-markdown-content]') ?? container;
    if (!target) return;
    return () => {
      const mountedDom = mountedDomRef.current;
      if (!mountedDom) return;
      // Viewer controllers and transient interaction state belong to the
      // current renderer instance and must not cross the cache boundary.
      if (target.childNodes.length === 0 || shouldRefreshMermaidViewers(target)) return;
      if (Array.from(target.children).some((block) => !block.hasAttribute('data-md-id'))) return;
      if (target.querySelector('[data-md-copy-pending]')) return;
      const selection = window.getSelection();
      if (selection?.rangeCount && !selection.isCollapsed && selection.getRangeAt(0).intersectsNode(target)) return;
      const openMenu = target.querySelector<HTMLElement>('[data-md-menu]:not(.hidden)');
      const copiedButton = Array.from(target.querySelectorAll<HTMLButtonElement>('[data-md-action]'))
        .some((button) => button.getAttribute('title') === mountedDom.copiedLabel);
      if (openMenu || copiedButton) return;

      const fragment = document.createDocumentFragment();
      fragment.append(...Array.from(target.childNodes));
      detachedMarkdownDomCache.store({ ...mountedDom.key, fragment });
      streamPerfCount('ui.markdown_renderer.dom_cache.capture');
    };
  }, [containerRef]);

  // Synchronous first paint: while the async parse is in-flight, show escaped
  // plain text immediately so there is no blank frame on initial mount. Only
  // runs when the target is empty — subsequent updates keep the prior rich DOM
  // until the next async render morphs in (no flash). Mirrors OpenCode's
  // `initialValue: fallback(text)` resource pattern.
  React.useLayoutEffect(() => {
    const container = containerRef.current;
    const target = container?.querySelector<HTMLElement>('[data-markdown-content]') ?? container;
    if (!target) return;
    const decorationId = getMarkdownDecorationId(ctx);
    if (text && target.childNodes.length === 0) {
      const cachedBlocks = !streaming ? getCachedMarkdownBlocks(text, imageMode) : null;
      if (cachedBlocks) {
        let hasMermaidBlock = false;
        for (const cachedBlock of cachedBlocks) {
          const block = document.createElement('div');
          block.setAttribute('data-md-block', '');
          block.style.display = 'contents';
          block.innerHTML = cachedBlock.html;
          decorateMarkdown(block, ctx);
          block.setAttribute('data-md-id', cachedBlock.id);
          block.setAttribute(MARKDOWN_DECORATION_ID_ATTR, decorationId);
          hasMermaidBlock ||= shouldRefreshMermaidViewers(block);
          target.appendChild(block);
        }
        if (hasMermaidBlock) refreshMermaidViewers();
      } else {
        if (!streaming && !releaseRevealHoldRef.current) {
          releaseRevealHoldRef.current = revealGate?.hold() ?? null;
        }
        const block = document.createElement('div');
        block.setAttribute('data-md-block', '');
        block.style.display = 'contents';
        block.innerHTML = renderMarkdownSync(text, imageMode);
        decorateMarkdown(block, ctx);
        block.setAttribute(MARKDOWN_DECORATION_ID_ATTR, decorationId);
        target.appendChild(block);
        if (shouldRefreshMermaidViewers(block)) refreshMermaidViewers();
      }
    } else if (!mermaidViewerRef.current && shouldRefreshMermaidViewers(target)) {
      // StrictMode re-runs this setup after the cleanup probe. The DOM remains,
      // but the viewer registry does not, so recreate it without reinstalling
      // or re-decorating ordinary blocks.
      refreshMermaidViewers();
    }
  }, [containerRef, text, streaming, imageMode, ctx, refreshMermaidViewers, revealGate]);

  React.useEffect(() => () => {
    mermaidViewerRef.current?.cleanup();
    mermaidViewerRef.current = null;
  }, []);

  React.useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const target = container.querySelector<HTMLElement>('[data-markdown-content]') ?? container;
    let active = true;
    const renderRevision = renderRevisionRef.current;
    const decorationId = getMarkdownDecorationId(ctx);

    if (!streaming) {
      const cachedBlocks = getCachedMarkdownBlocks(text, imageMode);
      if (cachedBlocks && domMatchesRenderedBlocks(target, cachedBlocks, decorationId)) {
        mountedDomRef.current = domCacheKey
          ? { key: domCacheKey, copiedLabel: ctx.labels.copied }
          : null;
        streamPerfCount('ui.markdown_renderer.settled_paint.reused');
        scheduleTableLayout();
        releaseRevealHold();
        return;
      }
    }

    void renderMarkdownBlocks(text, streaming, imageMode).then((blocks) => {
      if (!active || renderRevisionRef.current !== renderRevision) return;
      const existing = Array.from(target.children) as HTMLElement[];
      // Capture before block reconciliation: streaming completion changes the
      // wrapper layout, and theme changes can replace entire decorated blocks.
      // Match by disclosure order plus heading so unrelated replacements cannot
      // inherit the previous disclosure's state. No persistent/global state.
      const disclosureStates = Array.from(target.querySelectorAll<HTMLDetailsElement>('details[data-md-details]'))
        .map((details) => ({ summary: details.querySelector('summary')?.textContent, open: details.open }));

      // Reconcile per block: only re-morph blocks whose content changed, leaving
      // stable leading blocks untouched. Keeps per-stream-step DOM work bounded
      // to the trailing (growing) block instead of the whole message.
      let enteredThisPass = 0;
      blocks.forEach((block, index) => {
        let el = existing[index];
        let isNewBlock = false;
        if (!el) {
          el = document.createElement('div');
          el.setAttribute('data-md-block', '');
          el.style.display = 'contents';
          target.appendChild(el);
          isNewBlock = true;
        }
        if (el.getAttribute('data-md-id') === block.id) {
          if (el.getAttribute(MARKDOWN_DECORATION_ID_ATTR) !== decorationId) {
            const hasMermaidBlock = shouldRefreshMermaidViewers(el);
            if (hasMermaidBlock) {
              mermaidViewerRef.current?.cleanup();
              mermaidViewerRef.current = null;
            }
            const replacement = document.createElement('div');
            replacement.setAttribute('data-md-block', '');
            replacement.style.display = 'contents';
            replacement.innerHTML = block.html;
            decorateMarkdown(replacement, ctx);
            replacement.setAttribute('data-md-id', block.id);
            replacement.setAttribute(MARKDOWN_DECORATION_ID_ATTR, decorationId);
            el.replaceWith(replacement);
            if (hasMermaidBlock || shouldRefreshMermaidViewers(replacement)) refreshMermaidViewers();
          }
          if (!mermaidViewerRef.current && shouldRefreshMermaidViewers(el)) {
            refreshMermaidViewers();
          }
          return;
        }

        const temp = document.createElement('div');
        temp.innerHTML = block.html;
        decorateMarkdown(temp, ctx);
        if (isNewBlock && streaming && index > 0) {
          // A freshly committed block enters with a short reveal. The class
          // goes on the block's children — the wrapper is display:contents
          // and cannot animate — and the transform never changes layout, so
          // row measurement stays exact. Skipped for the first block so a
          // full initial render does not shimmer. Several blocks committed
          // in one tick cascade with a small stagger instead of popping in
          // together.
          const delayMs = Math.min(enteredThisPass, 4) * 55;
          enteredThisPass += 1;
          for (const child of Array.from(temp.children)) {
            child.classList.add('oc-md-block-enter');
            if (delayMs > 0 && child instanceof HTMLElement) {
              child.style.setProperty('--oc-md-enter-delay', `${delayMs}ms`);
            }
          }
        }
        const hadMermaidBlock = shouldRefreshMermaidViewers(el);
        const tempHasMermaidBlock = shouldRefreshMermaidViewers(temp);
        morphdom(el, temp, {
          childrenOnly: true,
          onBeforeElUpdated: (fromEl, toEl) => {
            if (fromEl.matches('details[data-md-details]') && toEl.matches('details[data-md-details]')
              && fromEl.querySelector('summary')?.textContent === toEl.querySelector('summary')?.textContent) {
              toEl.toggleAttribute('open', fromEl.hasAttribute('open'));
            }
            return !fromEl.isEqualNode(toEl);
          },
        });
        el.setAttribute('data-md-id', block.id);
        el.setAttribute(MARKDOWN_DECORATION_ID_ATTR, decorationId);
        if (hadMermaidBlock || tempHasMermaidBlock || shouldRefreshMermaidViewers(el)) {
          refreshMermaidViewers();
        }
      });

      const hadMermaidBeforeTrailingCleanup = shouldRefreshMermaidViewers(target);
      let removedMermaidBlock = false;
      for (let i = existing.length - 1; i >= blocks.length; i -= 1) {
        const removed = existing[i];
        if (removed && shouldRefreshMermaidViewers(removed)) {
          removedMermaidBlock = true;
        }
        removed?.remove();
      }
      if (removedMermaidBlock || (existing.length > blocks.length && hadMermaidBeforeTrailingCleanup)) {
        refreshMermaidViewers();
      }
      if (disclosureStates.length > 0) {
        target.querySelectorAll<HTMLDetailsElement>('details[data-md-details]').forEach((details, index) => {
          const previous = disclosureStates[index];
          if (previous && previous.summary === details.querySelector('summary')?.textContent) {
            details.open = previous.open;
          }
        });
      }
      mountedDomRef.current = domCacheKey
        ? { key: domCacheKey, copiedLabel: ctx.labels.copied }
        : null;
      scheduleTableLayout();
      releaseRevealHold();
    });

    return () => {
      active = false;
    };
  }, [containerRef, ctx, domCacheKey, imageMode, refreshMermaidViewers, releaseRevealHold, scheduleTableLayout, streaming, text]);

  React.useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    return attachMarkdownInteractions(container, ctx);
  }, [containerRef, ctx]);

  // Apply syntax CSS variables imperatively so they survive morphdom updates.
  React.useEffect(() => {
    const container = containerRef.current;
    const target = container?.querySelector<HTMLElement>('[data-markdown-content]') ?? container;
    if (!target) return;
    for (const [key, value] of Object.entries(syntaxVars)) {
      target.style.setProperty(key, value);
    }
  }, [containerRef, syntaxVars]);

  React.useEffect(() => {
    const container = containerRef.current;
    const target = container?.querySelector<HTMLElement>('[data-markdown-content]') ?? container;
    if (!target) return;
    if (ctx.deferCodeLineNumberSync) return;
    applyMarkdownCodeBlockWrapState(target, ctx.codeBlockLineWrap, ctx.labels);
  }, [containerRef, ctx.codeBlockLineWrap, ctx.deferCodeLineNumberSync, ctx.labels]);

};

const markdownContentClassName = (variant: MarkdownVariant): string =>
  variant === 'tool'
    ? 'markdown-content markdown-tool'
    : variant === 'reasoning'
      ? 'markdown-content markdown-reasoning'
      : 'markdown-content leading-relaxed';

const MarkdownRendererImpl: React.FC<MarkdownRendererProps> = ({
  content,
  part,
  messageId,
  isAnimated = true,
  skipFadeIn = false,
  className,
  isStreaming = false,
  disableStreamAnimation = false,
  variant = 'assistant',
  onShowPopup,
  enableFileReferences = true,
}) => {
  streamPerfCount('ui.markdown_renderer.render');
  if (isStreaming) streamPerfCount('ui.markdown_renderer.render.streaming');
  streamPerfObserve('ui.markdown_renderer.content_len', content.length);
  const currentTheme = useCurrentMermaidTheme();
  const containerRef = React.useRef<HTMLDivElement>(null);
  const effectiveDirectory = useEffectiveDirectory() ?? '';
  const homeDirectory = useHomeDirectory();
  const runtimeApis = useRuntimeAPIs();
  const openContextPreview = useUIStore((state) => state.openContextPreview);

  const handlePreviewLoopback = React.useCallback((url: string) => {
    if (!effectiveDirectory) return;
    openContextPreview(effectiveDirectory, url);
  }, [effectiveDirectory, openContextPreview]);

  const { t, locale } = useI18n();
  const handleExpandTable = React.useCallback((markdown: string) => {
    onShowPopup?.({
      open: true,
      title: t('markdownRenderer.table.actions.expandTitle'),
      content: markdown,
      metadata: { tool: MARKDOWN_POPUP_TOOL },
    });
  }, [onShowPopup, t]);

  const live = isStreaming && !disableStreamAnimation;

  // Reveal needs a runtime that owns a filesystem: the browser client has no
  // shell to open, so the menu item would be dead there. The check runs when the
  // menu opens, never during render.
  const getRevealFileLinkAction = React.useCallback((path: string) => {
    const revealPath = runtimeApis.files?.revealPath;
    if (!revealPath || isBrowserClientRuntime(runtimeApis.runtime.platform)) {
      return null;
    }

    return () => {
      void (async () => {
        if (effectiveDirectory && !isFilePathWithinDirectory(path, effectiveDirectory)) {
          await ensureOutsideFileGrantForDesktop(path, effectiveDirectory);
        }
        await revealPath(path).catch(() => undefined);
      })();
    };
  }, [effectiveDirectory, runtimeApis]);

  useMermaidInlineInteractions({
    containerRef,
    onShowPopup,
    enableFullscreen: DEFAULT_MERMAID_FULLSCREEN_ENABLED,
    enablePanZoom: DEFAULT_MERMAID_CONTROLS.showPanZoomControls,
  });
  useFileReferenceInteractions({
    containerRef,
    effectiveDirectory,
    homeDirectory,
    enabled: enableFileReferences && !isStreaming,
  });
  useLinkInteractions({ containerRef });
  useFileLinkContextMenu({
    containerRef,
    revealLabel: t(getRevealLabelKey()),
    getRevealAction: enableFileReferences && !isStreaming ? getRevealFileLinkAction : undefined,
  });

  const syntaxVars = React.useMemo(() => getMarkdownSyntaxVars(currentTheme), [currentTheme]);
  const ctx = useDecorateContext(
    currentTheme,
    live,
    effectiveDirectory ? handlePreviewLoopback : undefined,
    DEFAULT_MERMAID_CONTROLS,
    onShowPopup ? handleExpandTable : undefined,
  );
  const imageMode: MarkdownImageMode = variant === 'assistant' ? 'label' : 'inline';
  const settledPart = part
    && (part.type === 'text' || part.type === 'reasoning')
    && part.time?.end !== undefined
    ? part
    : null;
  const runtimeKey = getRuntimeKey();
  // Memoized on scalar identities, not the part object: sync-store reducers
  // recreate part objects on unrelated updates, and an object-identity dep
  // re-ran the async render pipeline for identical content.
  const settledSessionID = settledPart?.sessionID;
  const settledMessageID = settledPart?.messageID;
  const settledPartID = settledPart?.id;
  const domCacheKey = React.useMemo<DetachedMarkdownDomKey | null>(() => {
    // Streaming, unfinished, oversized, and identity-less Markdown continues
    // through the normal rendering pipeline and never retains detached DOM.
    if (isStreaming || !settledSessionID || !settledMessageID || !settledPartID || content.length === 0 || content.length > MARKDOWN_DOM_CACHE_MAX_SOURCE_CHARS) return null;
    // content.length is a cheap fingerprint: an edited or reverted part that
    // re-materializes under the same id must not restore the old DOM.
    return {
      scope: `${runtimeKey}\0${settledSessionID}`,
      id: `${settledMessageID}\0${settledPartID}\0${imageMode}\0${content.length}`,
      locale,
      directory: effectiveDirectory,
    };
  }, [content.length, effectiveDirectory, imageMode, isStreaming, locale, runtimeKey, settledSessionID, settledMessageID, settledPartID]);
  // Identity for the fade-in wrapper: a new part/message restarts the animation.
  const fadeKey = `markdown-${part?.id ? `part-${part.id}` : `message-${messageId}`}`;

  useMorphdomMarkdown({
    containerRef,
    text: content,
    streaming: live,
    imageMode,
    syntaxVars,
    ctx,
    domCacheKey,
    tableLayoutSettled: !isStreaming,
  });

  const markdownContent = (
    <div className={cn('break-words w-full min-w-0', className)} ref={containerRef}>
      <div className={markdownContentClassName(variant)} data-markdown-content />
    </div>
  );

  if (isAnimated) {
    return (
      <FadeInOnReveal key={fadeKey} skipAnimation={skipFadeIn}>
        {markdownContent}
      </FadeInOnReveal>
    );
  }

  return markdownContent;
};

export const MarkdownRenderer = React.memo(MarkdownRendererImpl, (prev, next) => {
  return prev.content === next.content
    && prev.isStreaming === next.isStreaming
    && prev.disableStreamAnimation === next.disableStreamAnimation
    && prev.variant === next.variant
    && prev.isAnimated === next.isAnimated
    && prev.skipFadeIn === next.skipFadeIn
    && prev.className === next.className
    && prev.messageId === next.messageId
    && prev.onShowPopup === next.onShowPopup
    && prev.enableFileReferences === next.enableFileReferences
    && prev.part?.id === next.part?.id;
});

const SimpleMarkdownRendererImpl: React.FC<{
  content: string;
  className?: string;
  variant?: MarkdownVariant;
  // App links remain confirmed even where ordinary HTTP link handling is off.
  disableLinkSafety?: boolean;
  stripFrontmatter?: boolean;
  onShowPopup?: (content: ToolPopupContent) => void;
  mermaidControls?: MermaidControlOptions;
  allowMermaidWheelEvents?: boolean;
  enableFileReferences?: boolean;
}> = ({
  content,
  className,
  variant = 'assistant',
  disableLinkSafety,
  stripFrontmatter = false,
  onShowPopup,
  mermaidControls = DEFAULT_MERMAID_CONTROLS,
  allowMermaidWheelEvents = false,
  enableFileReferences = true,
}) => {
  const currentTheme = useCurrentMermaidTheme();
  const containerRef = React.useRef<HTMLDivElement>(null);
  const effectiveDirectory = useEffectiveDirectory() ?? '';
  const homeDirectory = useHomeDirectory();

  const renderedContent = React.useMemo(
    () => (stripFrontmatter ? stripLeadingFrontmatter(content) : content),
    [content, stripFrontmatter],
  );

  useMermaidInlineInteractions({
    containerRef,
    onShowPopup,
    enableFullscreen: DEFAULT_MERMAID_FULLSCREEN_ENABLED,
    enablePanZoom: mermaidControls.showPanZoomControls,
    allowMermaidWheelEvents,
  });
  useFileReferenceInteractions({
    containerRef,
    effectiveDirectory,
    homeDirectory,
    enabled: enableFileReferences,
  });
  useLinkInteractions({ containerRef, enabled: !disableLinkSafety });

  const syntaxVars = React.useMemo(() => getMarkdownSyntaxVars(currentTheme), [currentTheme]);
  const ctx = useDecorateContext(currentTheme, false, undefined, mermaidControls);

  useMorphdomMarkdown({
    containerRef,
    text: renderedContent,
    streaming: false,
    syntaxVars,
    ctx,
    tableLayoutSettled: true,
  });

  return (
    <div className={cn('break-words w-full min-w-0', className)} ref={containerRef}>
      <div className={markdownContentClassName(variant)} data-markdown-content />
    </div>
  );
};

export const SimpleMarkdownRenderer = React.memo(SimpleMarkdownRendererImpl, (prev, next) => {
  const prevMermaidControls = prev.mermaidControls ?? DEFAULT_MERMAID_CONTROLS;
  const nextMermaidControls = next.mermaidControls ?? DEFAULT_MERMAID_CONTROLS;

  return prev.content === next.content
    && prev.variant === next.variant
    && prev.className === next.className
    && prev.disableLinkSafety === next.disableLinkSafety
    && prev.stripFrontmatter === next.stripFrontmatter
    && prev.onShowPopup === next.onShowPopup
    && prevMermaidControls.download === nextMermaidControls.download
    && prevMermaidControls.copy === nextMermaidControls.copy
    && prevMermaidControls.showPanZoomControls === nextMermaidControls.showPanZoomControls
    && prev.allowMermaidWheelEvents === next.allowMermaidWheelEvents
    && prev.enableFileReferences === next.enableFileReferences;
});
