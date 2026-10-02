import {
  $createParagraphNode,
  $createTextNode,
  $getNodeByKey,
  $getRoot,
  $getSelection,
  $insertNodes,
  $isElementNode,
  $isNodeSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_HIGH,
  createEditor,
  DELETE_CHARACTER_COMMAND,
  ElementNode,
  FORMAT_TEXT_COMMAND,
  KEY_BACKSPACE_COMMAND,
  KEY_DELETE_COMMAND,
  RootNode,
} from 'lexical';
import {
  INSERT_ORDERED_LIST_COMMAND,
  INSERT_UNORDERED_LIST_COMMAND,
  ListItemNode,
  ListNode,
  registerList,
  $createListNode,
  $createListItemNode,
  $isListItemNode,
  $isListNode,
} from '@lexical/list';
import {
  INSERT_TABLE_COMMAND,
  TableCellNode,
  TableNode,
  TableRowNode,
  registerTablePlugin,
  $createTableNodeWithDimensions,
  $isTableNode,
  $isTableRowNode,
  $isTableCellNode,
} from '@lexical/table';
import { registerRichText } from '@lexical/rich-text';
import { createEmptyHistoryState, registerHistory } from '@lexical/history';
import { REDO_COMMAND, UNDO_COMMAND } from 'lexical';
import 'mathlive';

export class MathNode extends ElementNode {
  static getType() { return 'math'; }
  static clone(node) { return new MathNode(node.__latex, node.__display, node.__key); }

  constructor(latex = '', display = false, key) {
    super(key);
    this.__latex = latex;
    this.__display = !!display;
  }

  createDOM() {
    const dom = document.createElement(this.__display ? 'div' : 'span');
    dom.className = this.__display ? 'lexical-math-node display' : 'lexical-math-node';
    dom.dataset.mathNodeKey = this.getKey();
    dom.contentEditable = 'false';
    dom.textContent = this.__display ? `$$${this.__latex}$$` : `\\(${this.__latex}\\)`;
    return dom;
  }

  updateDOM(prevNode, dom) {
    if (prevNode.__latex !== this.__latex || prevNode.__display !== this.__display) {
      dom.className = this.__display ? 'lexical-math-node display' : 'lexical-math-node';
      dom.textContent = this.__display ? `$$${this.__latex}$$` : `\\(${this.__latex}\\)`;
    }
    return false;
  }

  isInline() { return !this.__display; }
  canBeEmpty() { return false; }
  // These nodes are visually non-editable, but the caret must be allowed
  // to sit immediately before/after them so Lexical can provide a normal
  // insertion point and its block-cursor behavior.
  canInsertTextBefore() { return true; }
  canInsertTextAfter() { return true; }

  insertNewAfter(_selection, restoreSelection = true) {
    const paragraph = $createParagraphNode();
    this.insertAfter(paragraph, restoreSelection);
    return paragraph;
  }

  getLatex() { return this.__latex; }
  getDisplay() { return this.__display; }
  setLatex(latex) { this.getWritable().__latex = latex; }

  exportJSON() {
    return { type: 'math', version: 1, latex: this.__latex, display: this.__display };
  }

  static importJSON(serialized) {
    return new MathNode(serialized.latex || '', !!serialized.display);
  }
}


export class FigureNode extends ElementNode {
  static getType() { return 'figure'; }
  static clone(node) { return new FigureNode(node.__src, node.__alt, node.__caption, node.__key); }

  constructor(src = '', alt = '', caption = '', key) {
    super(key);
    this.__src = src;
    this.__alt = alt;
    this.__caption = caption;
  }

  createDOM() {
    const figure = document.createElement('figure');
    figure.className = 'lexical-figure-node';
    figure.dataset.figureNodeKey = this.getKey();
    figure.contentEditable = 'false';

    const img = document.createElement('img');
    img.src = assetUrl(this.__src);
    img.alt = this.__alt || '';
    figure.appendChild(img);

    if (this.__caption) {
      const caption = document.createElement('figcaption');
      caption.textContent = this.__caption;
      figure.appendChild(caption);
    }

    return figure;
  }

  updateDOM(prevNode, dom) {
    return (
      prevNode.__src !== this.__src ||
      prevNode.__alt !== this.__alt ||
      prevNode.__caption !== this.__caption
    );
  }

  isInline() { return false; }
  canBeEmpty() { return false; }
  // These nodes are visually non-editable, but the caret must be allowed
  // to sit immediately before/after them so Lexical can provide a normal
  // insertion point and its block-cursor behavior.
  canInsertTextBefore() { return true; }
  canInsertTextAfter() { return true; }

  insertNewAfter(_selection, restoreSelection = true) {
    const paragraph = $createParagraphNode();
    this.insertAfter(paragraph, restoreSelection);
    return paragraph;
  }

  getSrc() { return this.__src; }
  getAlt() { return this.__alt; }
  getCaption() { return this.__caption; }
  setFigure(src, alt = '', caption = '') {
    const writable = this.getWritable();
    writable.__src = src;
    writable.__alt = alt;
    writable.__caption = caption;
  }

  exportJSON() {
    return { type: 'figure', version: 1, src: this.__src, alt: this.__alt, caption: this.__caption };
  }

  static importJSON(serialized) {
    return new FigureNode(serialized.src || '', serialized.alt || '', serialized.caption || '');
  }
}

const MARKS = ['bold', 'italic', 'underline', 'strikethrough'];

function textMarks(node) {
  return MARKS.filter(mark => node.hasFormat(mark));
}

function assetUrl(src) {
  if (!src) return '';
  if (/^(https?:|data:|blob:|\/)/.test(src)) return src;
  const path = src.replace(/^\/+/, '');
  return `/asset/${path.startsWith('data/') ? path : `data/${path}`}`;
}

function isAtomicContentNode(node) {
  return node instanceof MathNode || node instanceof FigureNode || $isTableNode(node);
}

function isTerminalBlockNode(node) {
  return node instanceof FigureNode || $isTableNode(node) || (node instanceof MathNode && node.getDisplay());
}

function isEmptyParagraphNode(node) {
  return $isElementNode(node) && node.getType?.() === 'paragraph' && node.getChildrenSize() === 0;
}

function selectOrCreateParagraphBefore(node) {
  const previous = node.getPreviousSibling();
  if ($isElementNode(previous) && previous.getType?.() === 'paragraph') {
    previous.selectEnd();
    return previous;
  }
  const paragraph = $createParagraphNode();
  node.insertBefore(paragraph);
  paragraph.select();
  return paragraph;
}

function selectOrCreateParagraphAfter(node) {
  const next = node.getNextSibling();
  if ($isElementNode(next) && next.getType?.() === 'paragraph') {
    next.selectStart();
    return next;
  }
  const paragraph = $createParagraphNode();
  node.insertAfter(paragraph);
  paragraph.select();
  return paragraph;
}

function ensureTrailingParagraph(root, select = false) {
  const last = root.getLastChild();
  if (!last || !isTerminalBlockNode(last)) return null;

  const paragraph = $createParagraphNode();
  root.append(paragraph);
  if (select) paragraph.select();
  return paragraph;
}

function getAtomicSiblingAtDeletionBoundary(point, isBackward) {
  const node = point.getNode();

  if (point.type === 'element') {
    const children = node.getChildren();
    if (isBackward) {
      if (point.offset > 0 && point.offset <= children.length) return children[point.offset - 1];
      if (point.offset === 0) return node.getPreviousSibling();
    } else {
      if (point.offset >= 0 && point.offset < children.length) return children[point.offset];
      if (point.offset === children.length) return node.getNextSibling();
    }
    return null;
  }

  if (point.type === 'text') {
    const textLength = node.getTextContentSize();
    if (isBackward && point.offset === 0) {
      return node.getPreviousSibling() || node.getParent()?.getPreviousSibling() || null;
    }
    if (!isBackward && point.offset === textLength) {
      return node.getNextSibling() || node.getParent()?.getNextSibling() || null;
    }
  }

  return null;
}

function serializeInline(node) {
  if (node instanceof MathNode) {
    return { type: 'math', latex: node.getLatex(), display: node.getDisplay() };
  }
  if (node.getType?.() === 'text') {
    return { type: 'text', text: node.getTextContent(), ...(textMarks(node).length ? { marks: textMarks(node) } : {}) };
  }
  return null;
}

function serializeChildren(children) {
  return children.flatMap(child => {
    const value = serializeBlock(child);
    return value ? [value] : [];
  });
}

function serializeInlines(children) {
  return children.flatMap(child => {
    const value = serializeInline(child);
    return value ? [value] : [];
  });
}

function serializeBlock(node) {
  if (node instanceof MathNode) {
    return { type: 'math', latex: node.getLatex(), display: true };
  }

  if (node instanceof FigureNode) {
    return { type: 'figure', src: node.getSrc(), alt: node.getAlt(), caption: node.getCaption() };
  }

  if ($isListNode(node)) {
    const type = node.getListType() === 'number' ? 'numbered_list' : 'bullet_list';
    const items = node.getChildren().filter($isListItemNode).map(item => ({
      inlines: serializeInlines(item.getChildren()),
    }));
    return { type, items };
  }

  if ($isTableNode(node)) {
    const rows = node.getChildren().filter($isTableRowNode).map(row => ({
      cells: row.getChildren().filter($isTableCellNode).map(cell => ({
        content: serializeChildren(cell.getChildren()),
      })),
    }));
    return { type: 'table', rows, header_rows: 0 };
  }

  if ($isElementNode(node)) {
    const inlines = serializeInlines(node.getChildren());
    return { type: 'paragraph', inlines };
  }

  return null;
}

function appendInlines(parent, inlines) {
  for (const inline of inlines || []) {
    if (inline.type === 'math') {
      parent.append(new MathNode(inline.latex || '', !!inline.display));
      continue;
    }
    const node = $createTextNode(inline.text || '');
    for (const mark of inline.marks || []) {
      node.toggleFormat(mark);
    }
    parent.append(node);
  }
}

function appendContentBlocks(parent, blocks) {
  for (const block of blocks || []) {
    if (block.type === 'paragraph') {
      const p = $createParagraphNode();
      appendInlines(p, block.inlines);
      parent.append(p);
    } else if (block.type === 'bullet_list' || block.type === 'numbered_list') {
      const list = $createListNode(block.type === 'numbered_list' ? 'number' : 'bullet');
      for (const item of block.items || []) {
        const li = $createListItemNode();
        appendInlines(li, item.inlines);
        list.append(li);
      }
      parent.append(list);
    } else if (block.type === 'table') {
      const rows = block.rows || [];
      const cols = Math.max(1, ...rows.map(r => (r.cells || []).length));
      const table = $createTableNodeWithDimensions(Math.max(1, rows.length), cols, !!block.header_rows);
      const tableRows = table.getChildren().filter($isTableRowNode);
      rows.forEach((row, r) => {
        const tableCells = tableRows[r]?.getChildren().filter($isTableCellNode) || [];
        (row.cells || []).forEach((cell, c) => {
          const target = tableCells[c];
          if (!target) return;
          target.clear();
          appendContentBlocks(target, cell.content || []);
        });
      });
      parent.append(table);
    } else if (block.type === 'figure') {
      parent.append(new FigureNode(block.src || '', block.alt || '', block.caption || ''));
    } else if (block.type === 'math') {
      parent.append(new MathNode(block.latex || '', true));
    }
  }
}

function normalizeEmpty(editor) {
  editor.update(() => {
    const root = $getRoot();
    if (root.getChildrenSize() === 0) root.append($createParagraphNode());
  }, { tag: 'history-merge' });
}

const SUPPORTED_BLOCK_TYPES = new Set(['paragraph', 'bullet_list', 'numbered_list', 'table', 'figure', 'math']);
const SUPPORTED_MARKS = new Set(MARKS);

function validationError(path, message) {
  return `${path}: ${message}`;
}

function validateInline(inline, path = 'inline') {
  if (!inline || typeof inline !== 'object' || Array.isArray(inline)) return validationError(path, 'must be an object');
  if (inline.type === 'text') {
    if (typeof inline.text !== 'string') return validationError(path, 'text must be a string');
    if (inline.marks !== undefined) {
      if (!Array.isArray(inline.marks) || inline.marks.some(mark => !SUPPORTED_MARKS.has(mark))) {
        return validationError(path, 'marks must be an array containing only bold, italic, underline, or strikethrough');
      }
    }
    return null;
  }
  if (inline.type === 'math') {
    if (typeof inline.latex !== 'string') return validationError(path, 'math latex must be a string');
    if (inline.display !== undefined && typeof inline.display !== 'boolean') return validationError(path, 'math display must be boolean');
    if (inline.display === true) return validationError(path, 'inline math cannot have display=true');
    return null;
  }
  return validationError(path, 'unsupported inline type');
}

function validateBlocks(blocks, path = 'content') {
  if (!Array.isArray(blocks)) return validationError(path, 'must be an array');
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const bp = `${path}[${i}]`;
    if (!block || typeof block !== 'object' || Array.isArray(block)) return validationError(bp, 'must be an object');
    if (!SUPPORTED_BLOCK_TYPES.has(block.type)) return validationError(bp, `unsupported block type '${block.type}'`);

    if (block.type === 'paragraph') {
      if (!Array.isArray(block.inlines)) return validationError(`${bp}.inlines`, 'must be an array');
      for (let j = 0; j < block.inlines.length; j++) {
        const error = validateInline(block.inlines[j], `${bp}.inlines[${j}]`);
        if (error) return error;
      }
    } else if (block.type === 'bullet_list' || block.type === 'numbered_list') {
      if (!Array.isArray(block.items)) return validationError(`${bp}.items`, 'must be an array');
      for (let j = 0; j < block.items.length; j++) {
        const item = block.items[j];
        if (!item || typeof item !== 'object' || !Array.isArray(item.inlines)) return validationError(`${bp}.items[${j}].inlines`, 'must be an array');
        for (let k = 0; k < item.inlines.length; k++) {
          const error = validateInline(item.inlines[k], `${bp}.items[${j}].inlines[${k}]`);
          if (error) return error;
        }
      }
    } else if (block.type === 'table') {
      if (block.header_rows !== undefined && (!Number.isInteger(block.header_rows) || block.header_rows < 0)) return validationError(`${bp}.header_rows`, 'must be a non-negative integer');
      if (!Array.isArray(block.rows)) return validationError(`${bp}.rows`, 'must be an array');
      for (let r = 0; r < block.rows.length; r++) {
        const row = block.rows[r];
        if (!row || typeof row !== 'object' || !Array.isArray(row.cells)) return validationError(`${bp}.rows[${r}].cells`, 'must be an array');
        for (let c = 0; c < row.cells.length; c++) {
          const error = validateBlocks(row.cells[c]?.content, `${bp}.rows[${r}].cells[${c}].content`);
          if (error) return error;
        }
      }
    } else if (block.type === 'figure') {
      if (typeof block.src !== 'string' || !block.src.trim()) return validationError(`${bp}.src`, 'must be a non-empty string');
      if (block.alt !== undefined && typeof block.alt !== 'string') return validationError(`${bp}.alt`, 'must be a string');
      if (block.caption !== undefined && typeof block.caption !== 'string') return validationError(`${bp}.caption`, 'must be a string');
    } else if (block.type === 'math') {
      if (typeof block.latex !== 'string') return validationError(`${bp}.latex`, 'must be a string');
      if (block.display !== true) return validationError(`${bp}.display`, 'must be true for a display-math block');
    }
  }
  return null;
}

export function validateContentBlocks(blocks) {
  return validateBlocks(blocks, 'content');
}

export class ContentEditor {
  constructor(container, { placeholder = 'Start typing…', showToolbar = true, compact = false, toolbarMode = 'full', showJsonTools = false, jsonTitle = 'JSON', jsonAdapter = null, onFigureUpload = null } = {}) {
    this.container = container;
    this.showToolbar = showToolbar;
    this.compact = compact;
    this.toolbarMode = toolbarMode;
    this.showJsonTools = showJsonTools;
    this.jsonTitle = jsonTitle;
    this.jsonAdapter = jsonAdapter;
    this.onFigureUpload = onFigureUpload;
    this.changeHandler = null;
    this.activeMathKey = null;
    this._lastContentSignature = '';
    this._build();
    this.setPlaceholder(placeholder);
  }

  _build() {
    this.container.innerHTML = '';
    const rootWrap = document.createElement('div');
    rootWrap.className = `content-editor-shell${this.compact ? ' compact' : ''}`;

    if (this.showToolbar) {
      this.toolbar = document.createElement('div');
      this.toolbar.className = 'content-editor-toolbar';
      const fullButtons = [
        ['↶', 'Undo', () => this.editor.dispatchCommand(UNDO_COMMAND)],
        ['↷', 'Redo', () => this.editor.dispatchCommand(REDO_COMMAND)],
        ['B', 'Bold', () => this.editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'bold')],
        ['I', 'Italic', () => this.editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'italic')],
        ['U', 'Underline', () => this.editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'underline')],
        ['•', 'Bullet list', () => this.editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND)],
        ['1.', 'Numbered list', () => this.editor.dispatchCommand(INSERT_ORDERED_LIST_COMMAND)],
        ['▦', 'Insert table', () => this.editor.dispatchCommand(INSERT_TABLE_COMMAND, { rows: '2', columns: '2', includeHeaders: true })],
        ['▧', 'Insert figure', () => this.insertFigure()],
        ['∑', 'Insert math', () => this.openMathModal()],
      ];
      const minimalButtons = [
        ['B', 'Bold', () => this.editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'bold')],
        ['I', 'Italic', () => this.editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'italic')],
        ['U', 'Underline', () => this.editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'underline')],
        ['∑', 'Insert math', () => this.openMathModal()],
      ];
      const buttons = this.toolbarMode === 'minimal' ? minimalButtons : fullButtons;
      for (const [label, title, handler] of buttons) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'content-tool-btn';
        button.textContent = label;
        button.title = title;
        button.onclick = handler;
        this.toolbar.appendChild(button);
      }
      if (this.showJsonTools) {
        const separator = document.createElement('span');
        separator.className = 'content-toolbar-separator';
        this.toolbar.appendChild(separator);
        const exportButton = document.createElement('button');
        exportButton.type = 'button';
        exportButton.className = 'content-tool-btn content-json-btn';
        exportButton.textContent = '⇧';
        exportButton.title = `Export ${this.jsonTitle} JSON`;
        exportButton.setAttribute('aria-label', `Export ${this.jsonTitle} JSON`);
        exportButton.onclick = () => this.openJsonModal('export');
        this.toolbar.appendChild(exportButton);
        const importButton = document.createElement('button');
        importButton.type = 'button';
        importButton.className = 'content-tool-btn content-json-btn';
        importButton.textContent = '⇩';
        importButton.title = `Import ${this.jsonTitle} JSON`;
        importButton.setAttribute('aria-label', `Import ${this.jsonTitle} JSON`);
        importButton.onclick = () => this.openJsonModal('import');
        this.toolbar.appendChild(importButton);
      }
      rootWrap.appendChild(this.toolbar);
    }

    this.editable = document.createElement('div');
    this.editable.className = 'content-editor-input';
    this.editable.contentEditable = 'true';
    this.editable.setAttribute('role', 'textbox');
    this.editable.setAttribute('aria-multiline', 'true');
    rootWrap.appendChild(this.editable);
    this.container.appendChild(rootWrap);

    this.editor = createEditor({
      namespace: `TomatoContentEditor-${Math.random().toString(36).slice(2)}`,
      nodes: [ListNode, ListItemNode, TableNode, TableRowNode, TableCellNode, MathNode, FigureNode],
      onError: error => console.error('Lexical error', error),
    });
    this.editor.setRootElement(this.editable);
    this.cleanupRich = registerRichText(this.editor);
    this.cleanupList = registerList(this.editor);
    this.cleanupTable = registerTablePlugin(this.editor);
    this.cleanupHistory = registerHistory(this.editor, createEmptyHistoryState(), 300);
    this.cleanupTrailingParagraph = this.editor.registerNodeTransform(RootNode, root => {
      ensureTrailingParagraph(root);
    });
    this.cleanupDeleteCharacter = this.editor.registerCommand(
      DELETE_CHARACTER_COMMAND,
      isBackward => this._handleAtomicDeletion(isBackward),
      COMMAND_PRIORITY_HIGH,
    );
    this.cleanupBackspace = this.editor.registerCommand(
      KEY_BACKSPACE_COMMAND,
      event => {
        if (this._handleAtomicDeletion(true)) {
          event?.preventDefault();
          return true;
        }
        return false;
      },
      COMMAND_PRIORITY_HIGH,
    );
    this.cleanupDeleteKey = this.editor.registerCommand(
      KEY_DELETE_COMMAND,
      event => {
        if (this._handleAtomicDeletion(false)) {
          event?.preventDefault();
          return true;
        }
        return false;
      },
      COMMAND_PRIORITY_HIGH,
    );

    this.editor.registerUpdateListener(({ tags, dirtyElements, dirtyLeaves }) => {
      if (tags?.has('tomato-hydrate')) return;

      // Lexical also emits updates for cursor/selection/focus changes. Those
      // are not content edits and must never make the CMS dirty. A real text
      // or node edit marks at least one element/leaf dirty.
      const hasContentChanges =
        (dirtyElements && dirtyElements.size > 0) ||
        (dirtyLeaves && dirtyLeaves.size > 0);

      if (!hasContentChanges) return;

      const signature = this._contentSignature();
      if (signature === this._lastContentSignature) return;

      this._lastContentSignature = signature;
      if (this.changeHandler) this.changeHandler();
    });

    this.editable.addEventListener('click', event => {
      const mathTarget = event.target.closest?.('[data-math-node-key]');
      if (mathTarget) {
        event.preventDefault();
        event.stopPropagation();
        this.openMathModal(mathTarget.dataset.mathNodeKey);
        return;
      }
      const figureTarget = event.target.closest?.('[data-figure-node-key]');
      if (figureTarget) {
        event.preventDefault();
        event.stopPropagation();
        this.editFigure(figureTarget.dataset.figureNodeKey);
        return;
      }

      // The special block DOM is contentEditable=false, so the browser cannot
      // always hit-test a caret at its left/right edge. When the user clicks
      // in the editor gutter beside a top-level special block, turn that
      // click into a real paragraph boundary. This is shared by math, figures,
      // and tables rather than being tied to any one block type.
      if (event.target !== this.editable) return;

      const rootBlockKeys = [];
      this.editor.getEditorState().read(() => {
        const root = $getRoot();
        for (const child of root.getChildren()) {
          if (isTerminalBlockNode(child) || $isTableNode(child)) {
            rootBlockKeys.push(child.getKey());
          }
        }
      });

      for (const key of rootBlockKeys) {
        const dom = this.editor.getElementByKey(key);
        if (!dom) continue;
        const rect = dom.getBoundingClientRect();
        const withinVerticalBand = event.clientY >= rect.top && event.clientY <= rect.bottom;
        if (!withinVerticalBand) continue;

        if (event.clientX < rect.left) {
          this.editor.update(() => {
            const node = $getNodeByKey(key);
            if (node) selectOrCreateParagraphBefore(node);
          });
          return;
        }

        if (event.clientX > rect.right) {
          this.editor.update(() => {
            const node = $getNodeByKey(key);
            if (node) selectOrCreateParagraphAfter(node);
          });
          return;
        }
      }

      // Also handle the genuinely empty space immediately above/below the
      // first/last special block, including a document containing only one
      // special block.
      const firstKey = rootBlockKeys[0] || null;
      if (firstKey) {
        const firstDom = this.editor.getElementByKey(firstKey);
        if (firstDom && event.clientY < firstDom.getBoundingClientRect().top) {
          this.editor.update(() => {
            const first = $getNodeByKey(firstKey);
            if (first) selectOrCreateParagraphBefore(first);
          });
          return;
        }
      }

      const lastKey = rootBlockKeys[rootBlockKeys.length - 1] || null;
      if (lastKey) {
        const lastDom = this.editor.getElementByKey(lastKey);
        if (lastDom && event.clientY > lastDom.getBoundingClientRect().bottom) {
          this.editor.update(() => {
            const last = $getNodeByKey(lastKey);
            if (last) selectOrCreateParagraphAfter(last);
          });
        }
      }
    });

    this._setDefaults();
  }

  _setDefaults() {
    this.editor.update(() => {
      $getRoot().clear().append($createParagraphNode());
    }, { tag: 'history-merge' });

    this._lastContentSignature = this._contentSignature();
  }

  _contentSignature() {
    return JSON.stringify(this.getContent());
  }

  setPlaceholder(text) {
    this.editable.dataset.placeholder = text;
  }

  setContent(blocks) {
    this.editor.update(() => {
      const root = $getRoot();
      root.clear();
      appendContentBlocks(root, Array.isArray(blocks) ? blocks : []);
      if (root.getChildrenSize() === 0) root.append($createParagraphNode());
    }, { tag: 'tomato-hydrate' });

    // Establish the clean baseline after programmatic hydration.
    this._lastContentSignature = this._contentSignature();
  }

  getContent() {
    let blocks = [];
    this.editor.getEditorState().read(() => {
      const children = $getRoot().getChildren();
      const lastIndex = children.length - 1;
      const serializableChildren = children.filter((child, index) => !(index === lastIndex && isEmptyParagraphNode(child)));
      blocks = serializeChildren(serializableChildren);
    });
    return blocks;
  }

  onChange(callback) {
    this.changeHandler = callback;
  }

  getJsonValue() {
    if (this.jsonAdapter?.export) return this.jsonAdapter.export();
    return this.getContent();
  }

  applyJsonValue(value) {
    let result;
    if (this.jsonAdapter?.import) result = this.jsonAdapter.import(value);
    else {
      const error = validateContentBlocks(value);
      if (error) throw new Error(error);
      this.setContent(value);
      result = true;
    }
    if (this.changeHandler) requestAnimationFrame(() => this.changeHandler());
    return result;
  }

  openJsonModal(mode) {
    const modal = getJsonModal();
    modal.activeEditor = this;
    modal.mode = mode;
    modal.overlay.hidden = false;
    modal.title.textContent = mode === 'export' ? `Export ${this.jsonTitle} JSON` : `Import ${this.jsonTitle} JSON`;
    modal.copyButton.hidden = mode !== 'export';
    modal.applyButton.hidden = mode === 'export';
    modal.field.readOnly = mode === 'export';
    modal.field.value = mode === 'export'
      ? JSON.stringify(this.getJsonValue(), null, 2)
      : '';
    modal.status.textContent = mode === 'export'
      ? 'Copy this JSON into the Tomato QB Solution Writer plugin.'
      : 'Paste JSON here. It will be validated before anything is changed.';
    modal.status.className = 'content-json-status';
    modal.field.focus();
    if (mode === 'export') modal.field.select();
  }

  focus() { this.editor.focus(); }

  _pickImage() {
    return new Promise(resolve => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.style.display = 'none';
      document.body.appendChild(input);
      input.onchange = () => {
        const file = input.files?.[0] || null;
        input.remove();
        resolve(file);
      };
      input.oncancel = () => {
        input.remove();
        resolve(null);
      };
      input.click();
    });
  }

  async insertFigure() {
    if (!this.onFigureUpload) {
      const src = window.prompt('Figure path or URL', 'data/questions/.../ques_fig1.png');
      if (!src) return;
      const alt = window.prompt('Alt text (optional)', '') || '';
      const caption = window.prompt('Caption (optional)', '') || '';
      this.editor.update(() => {
        $insertNodes([new FigureNode(src.trim(), alt.trim(), caption.trim())]);
        ensureTrailingParagraph($getRoot(), true);
      });
      return;
    }

    const file = await this._pickImage();
    if (!file) return;

    const alt = window.prompt('Alt text (optional)', '') || '';
    const caption = window.prompt('Caption (optional)', '') || '';

    try {
      const src = await this.onFigureUpload(file);
      if (!src) throw new Error('The image upload did not return a file path.');
      this.editor.update(() => {
        $insertNodes([new FigureNode(src, alt.trim(), caption.trim())]);
        ensureTrailingParagraph($getRoot(), true);
      });
    } catch (error) {
      window.alert(error?.message || 'Image upload failed.');
    }
  }

  async editFigure(key) {
    let current = null;
    this.editor.getEditorState().read(() => {
      const node = $getNodeByKey(key);
      if (node instanceof FigureNode) {
        current = { src: node.getSrc(), alt: node.getAlt(), caption: node.getCaption() };
      }
    });
    if (!current) return;

    if (!this.onFigureUpload) {
      const src = window.prompt('Figure path or URL', current.src);
      if (src === null) return;
      const alt = window.prompt('Alt text (optional)', current.alt) ?? current.alt;
      const caption = window.prompt('Caption (optional)', current.caption) ?? current.caption;
      this.editor.update(() => {
        const node = $getNodeByKey(key);
        if (node instanceof FigureNode) node.setFigure(src.trim(), alt.trim(), caption.trim());
      });
      return;
    }

    const file = await this._pickImage();
    if (!file) return;

    const alt = window.prompt('Alt text (optional)', current.alt) ?? current.alt;
    const caption = window.prompt('Caption (optional)', current.caption) ?? current.caption;

    try {
      const src = await this.onFigureUpload(file);
      if (!src) throw new Error('The image upload did not return a file path.');
      this.editor.update(() => {
        const node = $getNodeByKey(key);
        if (node instanceof FigureNode) node.setFigure(src, alt.trim(), caption.trim());
      });
    } catch (error) {
      window.alert(error?.message || 'Image upload failed.');
    }
  }

  _handleAtomicDeletion(isBackward) {
    const selection = $getSelection();
    if (!selection) return false;

    if ($isNodeSelection(selection)) {
      const nodes = selection.getNodes();
      const atomicNodes = nodes.filter(isAtomicContentNode);
      if (!atomicNodes.length) return false;
      for (const node of atomicNodes) node.remove();
      return true;
    }

    if (!$isRangeSelection(selection) || !selection.isCollapsed()) return false;

    const adjacent = getAtomicSiblingAtDeletionBoundary(selection.anchor, isBackward);
    if (!isAtomicContentNode(adjacent)) return false;

    adjacent.remove();
    return true;
  }

  destroy() {
    this.cleanupRich?.();
    this.cleanupList?.();
    this.cleanupTable?.();
    this.cleanupHistory?.();
    this.cleanupTrailingParagraph?.();
    this.cleanupDeleteCharacter?.();
    this.cleanupBackspace?.();
    this.cleanupDeleteKey?.();
    this.editor.setRootElement(null);
  }

  openMathModal(existingKey = null) {
    this.activeMathKey = existingKey;
    const modal = getMathModal();
    modal.overlay.hidden = false;
    let latex = '';
    if (existingKey) {
      this.editor.getEditorState().read(() => {
        const node = $getNodeByKey(existingKey);
        if (node instanceof MathNode) latex = node.getLatex();
      });
    }
    modal.title.textContent = existingKey ? 'Edit mathematics' : 'Insert mathematics';
    modal.saveButton.textContent = existingKey ? 'Apply' : 'Insert';
    modal.field.value = latex;
    modal.latexInput.value = latex;
    modal.setTab('latex');
  }

  insertOrUpdateMath(latex) {
    if (this.activeMathKey) {
      const key = this.activeMathKey;
      this.editor.update(() => {
        const node = $getNodeByKey(key);
        if (node instanceof MathNode) node.setLatex(latex);
      });
    } else {
      this.editor.update(() => {
        $insertNodes([new MathNode(latex, false)]);
      });
    }
    this.activeMathKey = null;
  }
}

let jsonModal;
function getJsonModal() {
  if (jsonModal) return jsonModal;
  const overlay = document.createElement('div');
  overlay.className = 'content-json-modal';
  overlay.hidden = true;
  overlay.innerHTML = `
    <div class="content-json-dialog" role="dialog" aria-modal="true">
      <div class="content-json-head"><strong class="content-json-title">JSON</strong><button type="button" class="content-json-close" aria-label="Close">×</button></div>
      <p class="content-json-status"></p>
      <textarea class="content-json-field" spellcheck="false"></textarea>
      <div class="content-json-actions"><button type="button" class="btn secondary content-json-cancel">Close</button><button type="button" class="btn secondary content-json-copy">Copy JSON</button><button type="button" class="btn primary content-json-apply">Import JSON</button></div>
    </div>`;
  document.body.appendChild(overlay);
  const title = overlay.querySelector('.content-json-title');
  const field = overlay.querySelector('.content-json-field');
  const status = overlay.querySelector('.content-json-status');
  const copyButton = overlay.querySelector('.content-json-copy');
  const applyButton = overlay.querySelector('.content-json-apply');
  const close = () => { overlay.hidden = true; jsonModal.activeEditor = null; };
  overlay.querySelector('.content-json-close').onclick = close;
  overlay.querySelector('.content-json-cancel').onclick = close;
  overlay.addEventListener('click', event => { if (event.target === overlay) close(); });
  copyButton.onclick = async () => {
    try {
      await navigator.clipboard.writeText(field.value);
      status.textContent = 'Copied to clipboard.';
      status.className = 'content-json-status ok';
    } catch {
      field.focus(); field.select();
      status.textContent = 'Clipboard access was unavailable; the JSON is selected for manual copying.';
      status.className = 'content-json-status';
    }
  };
  applyButton.onclick = () => {
    try {
      const value = JSON.parse(field.value);
      jsonModal.activeEditor?.applyJsonValue(value);
      status.textContent = 'Imported successfully.';
      status.className = 'content-json-status ok';
      window.setTimeout(close, 250);
    } catch (error) {
      status.textContent = error?.message || 'Invalid JSON.';
      status.className = 'content-json-status error';
    }
  };
  jsonModal = { overlay, title, field, status, copyButton, applyButton, activeEditor: null, mode: null };
  return jsonModal;
}

let mathModal;
function getMathModal() {
  if (mathModal) return mathModal;

  const overlay = document.createElement('div');
  overlay.className = 'math-editor-modal';
  overlay.hidden = true;
  overlay.innerHTML = `
    <div class="math-editor-dialog" role="dialog" aria-modal="true" aria-label="Edit mathematics">
      <div class="math-editor-head">
        <strong class="math-editor-title">Insert mathematics</strong>
        <button type="button" class="math-editor-close" aria-label="Close">×</button>
      </div>
      <div class="math-editor-tabs" role="tablist" aria-label="Mathematics editing mode">
        <button type="button" class="math-editor-tab active" data-tab="latex" role="tab" aria-selected="true">LaTeX</button>
        <button type="button" class="math-editor-tab" data-tab="visual" role="tab" aria-selected="false">Visual</button>
      </div>
      <div class="math-editor-panel active" data-panel="latex" role="tabpanel">
        <textarea class="math-editor-latex" spellcheck="false" aria-label="LaTeX source" placeholder="Type LaTeX here…"></textarea>
      </div>
      <div class="math-editor-panel" data-panel="visual" role="tabpanel" hidden>
        <math-field class="math-editor-field"></math-field>
      </div>
      <div class="math-editor-actions">
        <button type="button" class="btn secondary math-cancel">Cancel</button>
        <button type="button" class="btn primary math-save">Insert</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const dialog = overlay.querySelector('.math-editor-dialog');
  const title = overlay.querySelector('.math-editor-title');
  const latexInput = overlay.querySelector('.math-editor-latex');
  const field = overlay.querySelector('math-field');
  const saveButton = overlay.querySelector('.math-save');
  const tabs = [...overlay.querySelectorAll('.math-editor-tab')];
  const panels = [...overlay.querySelectorAll('.math-editor-panel')];

  const setTab = tabName => {
    tabs.forEach(tab => {
      const active = tab.dataset.tab === tabName;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    panels.forEach(panel => {
      const active = panel.dataset.panel === tabName;
      panel.classList.toggle('active', active);
      panel.hidden = !active;
    });
    if (tabName === 'latex') latexInput.focus();
    else field.focus();
  };

  const closeMathMenu = () => {
    if (!mathModal?.menuOpen) return false;
    const toggle = field.shadowRoot?.querySelector('[part=\"menu-toggle\"]');
    if (toggle) toggle.click();
    mathModal.menuOpen = false;
    return true;
  };

  const wireMenuToggle = () => {
    const toggle = field.shadowRoot?.querySelector('[part=\"menu-toggle\"]');
    if (!toggle || toggle.dataset.tomatoQbMenuWired === '1') return;
    toggle.dataset.tomatoQbMenuWired = '1';
    toggle.addEventListener('click', () => {
      mathModal.menuOpen = !mathModal.menuOpen;
    });
  };

  const closeMenuOnOutsidePointer = event => {
    if (!mathModal || mathModal.overlay.hidden || !mathModal.menuOpen) return;
    const path = event.composedPath?.() || [];
    const isMenuRelated = path.some(node => {
      if (!(node instanceof Element)) return false;
      const part = node.getAttribute('part') || '';
      return node.getAttribute('role') === 'menu'
        || part.split(/\s+/).includes('menu')
        || part === 'menu-toggle'
        || node.classList.contains('ML__menu');
    });
    if (isMenuRelated) return;
    closeMathMenu();
  };

  if (field.shadowRoot) wireMenuToggle();
  field.addEventListener('mount', wireMenuToggle, { once: true });
  document.addEventListener('pointerdown', closeMenuOnOutsidePointer, true);

  const close = () => {
    closeMathMenu();
    overlay.hidden = true;
    mathModal.activeEditor = null;
  };

  tabs.forEach(tab => tab.onclick = () => setTab(tab.dataset.tab));
  latexInput.addEventListener('input', () => {
    if (mathModal.syncing) return;
    mathModal.syncing = true;
    field.value = latexInput.value;
    mathModal.syncing = false;
  });
  field.addEventListener('input', () => {
    if (mathModal.syncing) return;
    mathModal.syncing = true;
    latexInput.value = field.value || '';
    mathModal.syncing = false;
  });

  field.addEventListener('menu-select', () => {
    mathModal.menuOpen = false;
  });

  overlay.querySelector('.math-editor-close').onclick = close;
  overlay.querySelector('.math-cancel').onclick = close;
  saveButton.onclick = () => {
    if (mathModal.activeEditor) mathModal.activeEditor.insertOrUpdateMath(latexInput.value || field.value || '');
    close();
  };
  overlay.addEventListener('click', event => {
    if (event.target === overlay) close();
  });

  mathModal = { overlay, dialog, title, field, latexInput, saveButton, setTab, activeEditor: null, syncing: false, menuOpen: false };
  return mathModal;
}

const originalOpenMath = ContentEditor.prototype.openMathModal;
ContentEditor.prototype.openMathModal = function(existingKey = null) {
  const modal = getMathModal();
  modal.activeEditor = this;
  this.activeMathKey = existingKey;
  originalOpenMath.call(this, existingKey);
};
