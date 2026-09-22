import * as React from 'react';

import { SimpleMarkdownRenderer } from '@/components/chat/MarkdownRenderer';
import { cn } from '@/lib/utils';

// Below this the text stops being readable, so a table wider than the panel
// keeps its horizontal scroll instead of shrinking further.
const MIN_TABLE_FIT_SCALE = 0.5;
const SCALE_EPSILON = 0.005;

interface TableViewerViewProps {
  markdown: string | null;
  className?: string;
}

/**
 * Standalone surface for a single markdown table, opened by the VS Code
 * extension in an editor panel. The table scales down to the panel width so a
 * wide table stays fully visible without a horizontal scrollbar.
 */
export const TableViewerView: React.FC<TableViewerViewProps> = ({ markdown, className }) => {
  const viewportRef = React.useRef<HTMLDivElement>(null);
  const contentRef = React.useRef<HTMLDivElement>(null);
  const scaleRef = React.useRef(1);
  const [scale, setScale] = React.useState(1);

  React.useEffect(() => {
    const viewport = viewportRef.current;
    const content = contentRef.current;
    if (!viewport || !content) return;

    // The rendered width carries the applied zoom, so the natural table width
    // is recovered by dividing it back out; the next scale then stays stable.
    const fit = () => {
      const available = viewport.clientWidth;
      const applied = scaleRef.current || 1;
      const natural = content.getBoundingClientRect().width / applied;
      if (available <= 0 || natural <= 0) return;
      const next = Math.max(MIN_TABLE_FIT_SCALE, Math.min(1, available / natural));
      if (Math.abs(next - applied) < SCALE_EPSILON) return;
      scaleRef.current = next;
      setScale(next);
    };

    const observer = new ResizeObserver(fit);
    observer.observe(viewport);
    fit();
    return () => observer.disconnect();
  }, [markdown]);

  if (!markdown) return null;

  return (
    <div className={cn('h-full w-full overflow-auto', className)}>
      <div className="p-6">
        <div ref={viewportRef} className="w-full">
          <div ref={contentRef} style={{ zoom: scale }}>
            <SimpleMarkdownRenderer content={markdown} enableFileReferences={false} />
          </div>
        </div>
      </div>
    </div>
  );
};

TableViewerView.displayName = 'TableViewerView';
