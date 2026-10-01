function assetUrl(src) {
  if (!src) return '';
  if (/^(https?:|data:|blob:|\/)/.test(src)) return src;
  const path = src.replace(/^\/+/, '');
  return `/asset/${path.startsWith('data/') ? path : `data/${path}`}`;
}

function addInline(parent, inline) {
  if (!inline) return;

  if (inline.type === 'math') {
    const display = !!inline.display;
    const el = document.createElement(display ? 'div' : 'span');
    el.className = display ? 'render-math display' : 'render-math';
    el.dataset.mathLatex = inline.latex || '';
    el.dataset.mathDisplay = display ? 'true' : 'false';
    parent.appendChild(el);
    return;
  }

  const node = document.createElement('span');
  node.textContent = inline.text || '';

  for (const mark of inline.marks || []) {
    if (mark === 'bold') node.style.fontWeight = '700';
    if (mark === 'italic') node.style.fontStyle = 'italic';
    if (mark === 'underline') node.style.textDecoration = 'underline';
    if (mark === 'strikethrough') node.style.textDecoration = 'line-through';
  }

  parent.appendChild(node);
}

function renderBlocksInto(parent, blocks) {
  for (const block of blocks || []) {
    if (!block) continue;

    if (block.type === 'paragraph') {
      const el = document.createElement('p');
      el.className = 'content-paragraph';
      for (const inline of block.inlines || []) addInline(el, inline);
      parent.appendChild(el);
      continue;
    }

    if (block.type === 'bullet_list' || block.type === 'numbered_list') {
      const list = document.createElement(
        block.type === 'numbered_list' ? 'ol' : 'ul'
      );
      list.className = 'content-list';

      for (const item of block.items || []) {
        const li = document.createElement('li');
        for (const inline of item.inlines || []) addInline(li, inline);
        list.appendChild(li);
      }

      parent.appendChild(list);
      continue;
    }

    if (block.type === 'table') {
      const wrap = document.createElement('div');
      wrap.className = 'content-table-wrap';

      const table = document.createElement('table');
      table.className = 'content-table';

      (block.rows || []).forEach((row, rowIndex) => {
        const tr = document.createElement('tr');

        (row.cells || []).forEach(cell => {
          const cellEl = document.createElement(
            rowIndex < (block.header_rows || 0) ? 'th' : 'td'
          );

          renderBlocksInto(cellEl, cell.content || []);
          tr.appendChild(cellEl);
        });

        table.appendChild(tr);
      });

      wrap.appendChild(table);
      parent.appendChild(wrap);
      continue;
    }

    if (block.type === 'figure') {
      const figure = document.createElement('figure');

      const img = document.createElement('img');
      img.src = assetUrl(block.src);
      img.alt = block.alt || '';
      figure.appendChild(img);

      if (block.caption) {
        const figcaption = document.createElement('figcaption');
        figcaption.textContent = block.caption;
        figure.appendChild(figcaption);
      }

      parent.appendChild(figure);
      continue;
    }

    if (block.type === 'math') {
      const el = document.createElement('div');
      el.className = 'render-math display';
      el.dataset.mathLatex = block.latex || '';
      el.dataset.mathDisplay = 'true';
      parent.appendChild(el);
    }
  }
}

function getMathElements(targets) {
  const elements = [];

  for (const target of targets) {
    if (!target) continue;

    if (target.matches?.('.render-math')) {
      elements.push(target);
    }

    elements.push(...target.querySelectorAll?.('.render-math') || []);
  }

  return [...new Set(elements)];
}

function fallbackToTypeset(elements) {
  for (const element of elements) {
    const latex = element.dataset.mathLatex || '';
    const display = element.dataset.mathDisplay === 'true';
    element.textContent = display ? `$$${latex}$$` : `\\(${latex}\\)`;
  }

  return window.MathJax?.typesetPromise
    ? window.MathJax.typesetPromise(elements).catch(() => {})
    : Promise.resolve();
}

export async function typesetMath(elements) {
  const targets = Array.isArray(elements)
    ? elements.filter(Boolean)
    : [elements].filter(Boolean);

  if (!targets.length) return;

  const mathElements = getMathElements(targets);
  if (!mathElements.length) return;

  const mathJax = window.MathJax;

  if (!mathJax) {
    return;
  }

  try {
    if (mathJax.startup?.promise) {
      await mathJax.startup.promise;
    }

    if (typeof mathJax.tex2svgPromise !== 'function') {
      await fallbackToTypeset(mathElements);
      return;
    }

    await Promise.all(
      mathElements.map(async element => {
        const latex = element.dataset.mathLatex || '';
        const display = element.dataset.mathDisplay === 'true';

        element.replaceChildren();

        try {
          const rendered = await mathJax.tex2svgPromise(latex, { display });

          if (rendered) {
            element.replaceChildren(rendered);
          }
        } catch (error) {
          element.classList.add('math-render-error');
          element.textContent = display
            ? `$$${latex}$$`
            : `\\(${latex}\\)`;
          console.warn('MathJax rendering failed:', latex, error);
        }
      })
    );
  } catch (error) {
    await fallbackToTypeset(mathElements);
  }
}

export function renderContent(parent, blocks, { typeset = true } = {}) {
  parent.innerHTML = '';
  renderBlocksInto(parent, Array.isArray(blocks) ? blocks : []);

  if (typeset) {
    typesetMath(parent);
  }
}

export function contentToPlainText(blocks) {
  const parts = [];

  const walk = value => {
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }

    if (value && typeof value === 'object') {
      if (value.type === 'text') {
        parts.push(value.text || '');
      } else if (value.type === 'math') {
        parts.push(value.latex || '');
      } else if (value.type === 'figure') {
        parts.push(value.alt || '', value.caption || '');
      } else {
        Object.entries(value).forEach(([key, nested]) => {
          if (!['type', 'id', 'marks'].includes(key)) walk(nested);
        });
      }
    }
  };

  walk(blocks);
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}
