import { describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';

import { countGrantedFileLinks, FILE_LINK_ATTR, hasFileLinkBudget, type FileLinkContainer } from './fileReferenceLink';

type ContainerOptions = {
  links?: number;
  candidates?: number;
};

/**
 * A container shaped like a rendered message: path-shaped tokens that were not
 * turned into links, plus the links that were granted.
 */
const createContainer = ({ links = 0, candidates = 0 }: ContainerOptions): FileLinkContainer => {
  const window = new Window();
  const container = window.document.createElement('div');

  for (let index = 0; index < candidates; index += 1) {
    const code = window.document.createElement('code');
    code.textContent = `chat.compaction.tooltip.tokensBefore.${index}`;
    container.appendChild(code);
  }

  for (let index = 0; index < links; index += 1) {
    const anchor = window.document.createElement('a');
    anchor.setAttribute(FILE_LINK_ATTR, 'true');
    container.appendChild(anchor);
  }

  return container;
};

describe('file reference link budget', () => {
  test('counts granted links and ignores the tokens that stayed plain text', () => {
    expect(countGrantedFileLinks(createContainer({ links: 3, candidates: 40 }))).toBe(3);
  });

  test('leaves room while fewer links than the limit were granted', () => {
    expect(hasFileLinkBudget(createContainer({ links: 39, candidates: 40 }), 40)).toBe(true);
  });

  test('is spent once the limit of granted links is reached', () => {
    expect(hasFileLinkBudget(createContainer({ links: 40, candidates: 40 }), 40)).toBe(false);
  });

  test('is not spent by path-shaped tokens alone', () => {
    expect(hasFileLinkBudget(createContainer({ candidates: 200 }), 40)).toBe(true);
  });
});
