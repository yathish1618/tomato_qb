import {
  $createParagraphNode,
  $createTextNode,
  $getNodeByKey,
  $getRoot,
  $getSelection,
  $insertNodes,
  $isElementNode,
  $isRangeSelection,
  createEditor,
  ElementNode,
  FORMAT_TEXT_COMMAND,
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
  return `/asset/${src.startsWith('data/') ? src : `data/${src}`}`;
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

export class ContentEditor {
  constructor(container, { placeholder = 'Start typing…', showToolbar = true, compact = false, toolbarMode = 'full' } = {}) {
    this.container = container;
    this.showToolbar = showToolbar;
    this.compact = compact;
    this.toolbarMode = toolbarMode;
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

    this.editable.addEventListener('dblclick', event => {
      const mathTarget = event.target.closest?.('[data-math-node-key]');
      if (mathTarget) {
        this.openMathModal(mathTarget.dataset.mathNodeKey);
        return;
      }
      const figureTarget = event.target.closest?.('[data-figure-node-key]');
      if (figureTarget) this.editFigure(figureTarget.dataset.figureNodeKey);
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
      blocks = serializeChildren($getRoot().getChildren());
    });
    return blocks;
  }

  onChange(callback) {
    this.changeHandler = callback;
  }

  focus() { this.editor.focus(); }

  insertFigure() {
    const src = window.prompt('Figure path or URL', 'data/questions/.../figures/...');
    if (!src) return;
    const alt = window.prompt('Alt text (optional)', '') || '';
    const caption = window.prompt('Caption (optional)', '') || '';
    this.editor.update(() => {
      $insertNodes([new FigureNode(src.trim(), alt.trim(), caption.trim())]);
    });
  }

  editFigure(key) {
    let current = null;
    this.editor.getEditorState().read(() => {
      const node = $getNodeByKey(key);
      if (node instanceof FigureNode) {
        current = { src: node.getSrc(), alt: node.getAlt(), caption: node.getCaption() };
      }
    });
    if (!current) return;
    const src = window.prompt('Figure path or URL', current.src);
    if (src === null) return;
    const alt = window.prompt('Alt text (optional)', current.alt) ?? current.alt;
    const caption = window.prompt('Caption (optional)', current.caption) ?? current.caption;
    this.editor.update(() => {
      const node = $getNodeByKey(key);
      if (node instanceof FigureNode) node.setFigure(src.trim(), alt.trim(), caption.trim());
    });
  }

  destroy() {
    this.cleanupRich?.();
    this.cleanupList?.();
    this.cleanupTable?.();
    this.cleanupHistory?.();
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
    modal.field.value = latex;
    modal.field.focus();
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

let mathModal;
function getMathModal() {
  if (mathModal) return mathModal;
  const overlay = document.createElement('div');
  overlay.className = 'math-editor-modal';
  overlay.hidden = true;
  overlay.innerHTML = `
    <div class="math-editor-dialog">
      <div class="math-editor-head"><strong>Insert mathematics</strong><button type="button" class="math-editor-close">×</button></div>
      <math-field class="math-editor-field"></math-field>
      <div class="math-editor-actions"><button type="button" class="btn secondary math-cancel">Cancel</button><button type="button" class="btn primary math-save">Insert</button></div>
    </div>`;
  document.body.appendChild(overlay);
  const field = overlay.querySelector('math-field');
  const close = () => { overlay.hidden = true; mathModal.activeEditor = null; };
  overlay.querySelector('.math-editor-close').onclick = close;
  overlay.querySelector('.math-cancel').onclick = close;
  overlay.querySelector('.math-save').onclick = () => {
    if (mathModal.activeEditor) mathModal.activeEditor.insertOrUpdateMath(field.value || '');
    close();
  };
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  mathModal = { overlay, field, activeEditor: null };
  return mathModal;
}

const originalOpenMath = ContentEditor.prototype.openMathModal;
ContentEditor.prototype.openMathModal = function(existingKey = null) {
  const modal = getMathModal();
  modal.activeEditor = this;
  this.activeMathKey = existingKey;
  originalOpenMath.call(this, existingKey);
};
