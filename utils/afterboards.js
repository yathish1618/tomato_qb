(() => {
    /*
     * AfterBoards -> Tomato QB question scraper
     *
     * Output choices are intentionally kept in the Tomato QB shape:
     *   - answer: A/B/C/D
     *   - marks: 1
     *   - group_id: null
     *   - canonical content blocks with text/math/table/figure
     *
     * Tag extraction is based on the actual question header structure in the
     * saved AfterBoards HTML. The topic pill has changed internally between
     * questions (some versions use <p>, others <span>), so this code reads the
     * pill's text rather than depending on a particular nested tag name.
     *
     * The purple "common/core/applied" pill is deliberately NOT included in
     * tags because the previous scraper's intended output did not treat that
     * classification as a question tag.
     */

    const OPTION_LETTERS = ["A", "B", "C", "D"];

    const cleanWhitespace = (s) =>
        String(s ?? "")
            .replace(/\u00a0/g, " ")
            .replace(/\s+/g, " ")
            .trim();

    const latexFromKatex = (katexNode) => {
        const annotation = katexNode.querySelector(
            'annotation[encoding="application/x-tex"]'
        );
        return annotation ? annotation.textContent.trim() : null;
    };

    const pushInline = (inlines, item) => {
        if (!item) return;

        if (item.type === "text") {
            item.text = item.text.replace(/\s+/g, " ");
            if (!item.text) return;

            const last = inlines[inlines.length - 1];
            const itemMarks = Array.isArray(item.marks) ? item.marks : [];
            const lastMarks = Array.isArray(last?.marks) ? last.marks : [];
            const sameMarks =
                lastMarks.length === itemMarks.length &&
                lastMarks.every((mark, index) => mark === itemMarks[index]);

            if (last && last.type === "text" && sameMarks) {
                last.text += item.text;
            } else {
                inlines.push(item);
            }
            return;
        }

        inlines.push(item);
    };

    // Parse plain text that contains Markdown-style inline math such as $x^2$
    // and bold such as **correct** into separate Tomato inline nodes. AfterBoards
    // sometimes sends both formats as literal text instead of semantic HTML.
    const extractRawMathInlines = (text) => {
        const inlines = [];
        const textValue = String(text ?? "");
        const tokenRegex = /\$\$([\s\S]*?)\$\$|\$([^$\n]+?)\$|\*\*([\s\S]*?)\*\*|<img\b[^>]*>/gi;
        let lastIndex = 0;
        let match;

        const addText = (value) => {
            if (value == null || value === "") return;
            pushInline(inlines, {
                type: "text",
                text: value
            });
        };

        while ((match = tokenRegex.exec(textValue)) !== null) {
            addText(textValue.slice(lastIndex, match.index));

            if (match[1] !== undefined || match[2] !== undefined) {
                const latex = match[1] !== undefined ? match[1] : match[2];
                if (latex) {
                    pushInline(inlines, {
                        type: "math",
                        latex: latex.trim(),
                        display: false
                    });
                }
            } else if (match[3] !== undefined) {
                // Preserve Markdown bold in the same marks shape used by the
                // Tomato editor/store: { type: "text", text: "...", marks: ["bold"] }.
                extractRawMathInlines(match[3]).forEach((item) => {
                    if (item.type === "text") {
                        const marks = Array.isArray(item.marks) ? item.marks : [];
                        pushInline(inlines, {
                            ...item,
                            marks: [...new Set([...marks, "bold"])]
                        });
                    } else {
                        pushInline(inlines, item);
                    }
                });
            } else {
                pushInline(inlines, {
                    type: "text",
                    text: "[FIGURE]"
                });
            }

            lastIndex = tokenRegex.lastIndex;
        }

        addText(textValue.slice(lastIndex));
        return inlines;
    };

    // Convert a DOM subtree into canonical Tomato inline nodes while
    // preserving KaTeX as real math rather than flattening it to plain text.
    const extractInlines = (node) => {
        const inlines = [];

        const walk = (current, marks = []) => {
            if (current.nodeType === Node.TEXT_NODE) {
                extractRawMathInlines(current.textContent || "")
                    .forEach((item) => {
                        if (item.type === "text" && marks.length) {
                            const existingMarks = Array.isArray(item.marks) ? item.marks : [];
                            pushInline(inlines, {
                                ...item,
                                marks: [...new Set([...existingMarks, ...marks])]
                            });
                        } else {
                            pushInline(inlines, item);
                        }
                    });
                return;
            }

            if (current.nodeType !== Node.ELEMENT_NODE) return;

            if (current.matches(".katex")) {
                const latex = latexFromKatex(current);
                if (latex) {
                    pushInline(inlines, {
                        type: "math",
                        latex,
                        display: false
                    });
                } else {
                    pushInline(inlines, {
                        type: "text",
                        text: cleanWhitespace(current.innerText || "")
                    });
                }
                return;
            }

            if (current.nodeName === "BR") {
                pushInline(inlines, { type: "text", text: "\n" });
                return;
            }

            if (current.nodeName === "IMG") {
                pushInline(inlines, { type: "text", text: "[FIGURE]" });
                return;
            }

            const childMarks =
                current.nodeName === "STRONG" || current.nodeName === "B"
                    ? [...marks, "bold"]
                    : marks;

            Array.from(current.childNodes).forEach((child) => walk(child, childMarks));
        };

        walk(node);

        // Clean up whitespace introduced by HTML indentation while preserving
        // meaningful spaces around math/text boundaries.
        return inlines
            .map((item, index) => {
                if (item.type !== "text") return item;
                let text = item.text.replace(/[\t\r\f]+/g, " ");
                text = text.replace(/\s+/g, " ");
                if (index === 0) text = text.replace(/^\s+/, "");
                if (index === inlines.length - 1) text = text.replace(/\s+$/, "");
                return { ...item, text };
            })
            .filter((item) => item.type !== "text" || item.text.length > 0);
    };

    const paragraphFromNode = (node) => {
        const inlines = extractInlines(node);
        return inlines.length ? { type: "paragraph", inlines } : null;
    };

    const tableCellBlocks = (cell) => {
        const blocks = [];

        // HTML table cells can contain multiple <p> blocks.
        const paragraphs = Array.from(cell.querySelectorAll(':scope > .responsive-latex-container p, :scope > p, p'));

        if (paragraphs.length) {
            paragraphs.forEach((p) => {
                const block = paragraphFromNode(p);
                if (block) blocks.push(block);
            });
        } else {
            const block = paragraphFromNode(cell);
            if (block) blocks.push(block);
        }

        return blocks;
    };

    const getTableObj = (table) => {
        const rows = Array.from(table.querySelectorAll('tr'));
        if (!rows.length) return null;

        let headerRows = 0;
        const rowObjects = rows.map((row, rowIndex) => {
            const cells = Array.from(row.children).filter(
                (el) => el.nodeName === 'TD' || el.nodeName === 'TH'
            );

            if (rowIndex === 0 && cells.some((c) => c.nodeName === 'TH')) {
                headerRows = 1;
            }

            return {
                cells: cells.map((cell) => ({
                    content: tableCellBlocks(cell)
                }))
            };
        });

        return {
            type: 'table',
            header_rows: headerRows,
            rows: rowObjects
        };
    };

    // Serialize a DOM subtree to text while replacing rendered KaTeX with
    // lossless placeholders. This lets us recognise Markdown tables that the
    // website has rendered as plain text inside a <p>, while still restoring
    // every formula as a proper math inline node afterwards.
    const serializeRichText = (node) => {
        const placeholders = [];

        const walk = (current) => {
            if (current.nodeType === Node.TEXT_NODE) {
                return current.textContent || '';
            }

            if (current.nodeType !== Node.ELEMENT_NODE) return '';

            if (current.matches('.katex')) {
                const latex = latexFromKatex(current);
                if (latex) {
                    const index = placeholders.push(latex) - 1;
                    return `\uE000${index}\uE001`;
                }
                return current.innerText || '';
            }

            if (current.nodeName === 'BR') return '\n';

            if (current.nodeName === 'IMG') return '[FIGURE]';

            return Array.from(current.childNodes).map(walk).join('');
        };

        return {
            text: walk(node),
            placeholders
        };
    };

    const splitMarkdownRow = (line) => {
        let value = String(line || '').trim();
        if (value.startsWith('|')) value = value.slice(1);
        if (value.endsWith('|') && !value.endsWith('\\|')) value = value.slice(0, -1);

        const cells = [];
        let current = '';
        let escaped = false;

        for (const ch of value) {
            if (escaped) {
                current += ch;
                escaped = false;
            } else if (ch === '\\') {
                current += ch;
                escaped = true;
            } else if (ch === '|') {
                cells.push(current.trim());
                current = '';
            } else {
                current += ch;
            }
        }

        cells.push(current.trim());
        return cells;
    };

    const isMarkdownTableRow = (line) => {
        const value = String(line || '').trim();
        return value.includes('|') && splitMarkdownRow(value).length >= 2;
    };

    const isMarkdownSeparatorRow = (line) => {
        if (!isMarkdownTableRow(line)) return false;
        return splitMarkdownRow(line).every((cell) => /^:?-{3,}:?$/.test(cell.replace(/\s+/g, '')));
    };

    const stringToInlines = (value, placeholders = []) => {
        const inlines = [];
        const textValue = String(value ?? '');
        const tokenRegex = /\uE000(\d+)\uE001|\$\$([\s\S]*?)\$\$|\$([^$\n]+?)\$|\*\*([\s\S]*?)\*\*|<img\b[^>]*>/gi;
        let lastIndex = 0;
        let match;

        const addText = (text) => {
            const cleaned = String(text || '')
                .replace(/[\t\r\f]+/g, ' ')
                .replace(/\s+/g, ' ');
            if (!cleaned) return;
            pushInline(inlines, { type: 'text', text: cleaned });
        };

        while ((match = tokenRegex.exec(textValue)) !== null) {
            addText(textValue.slice(lastIndex, match.index));

            if (match[1] !== undefined) {
                const latex = placeholders[Number(match[1])];
                if (latex) {
                    pushInline(inlines, { type: 'math', latex, display: false });
                }
            } else if (match[2] !== undefined || match[3] !== undefined) {
                const latex = match[2] !== undefined ? match[2] : match[3];
                if (latex) {
                    pushInline(inlines, {
                        type: 'math',
                        latex: latex.trim(),
                        display: false
                    });
                }
            } else if (match[4] !== undefined) {
                const boldInlines = stringToInlines(match[4], placeholders);
                boldInlines.forEach((item) => {
                    if (item.type === 'text') {
                        const marks = Array.isArray(item.marks) ? item.marks : [];
                        pushInline(inlines, {
                            ...item,
                            marks: [...new Set([...marks, 'bold'])]
                        });
                    } else {
                        pushInline(inlines, item);
                    }
                });
            } else {
                pushInline(inlines, { type: 'text', text: '[FIGURE]' });
            }

            lastIndex = tokenRegex.lastIndex;
        }

        addText(textValue.slice(lastIndex));
        return inlines;
    };

    const paragraphFromRichText = (text, placeholders = []) => {
        const inlines = stringToInlines(text, placeholders);
        return inlines.length ? { type: 'paragraph', inlines } : null;
    };

    // Detect the Markdown-table representation used by AfterBoards for
    // Match-the-List questions. In the supplied HTML these are NOT <table>
    // elements; the entire table is inside a whitespace-pre-wrap <p>.
    const extractMarkdownTableBlocks = (paragraph) => {
        const { text, placeholders } = serializeRichText(paragraph);
        const lines = text.replace(/\r\n?/g, '\n').split('\n');

        let start = -1;
        for (let i = 0; i < lines.length - 1; i += 1) {
            if (isMarkdownTableRow(lines[i]) && isMarkdownSeparatorRow(lines[i + 1])) {
                start = i;
                break;
            }
        }

        if (start === -1) return null;

        let end = start + 2;
        while (end < lines.length && isMarkdownTableRow(lines[end]) && !isMarkdownSeparatorRow(lines[end])) {
            end += 1;
        }

        const headerCells = splitMarkdownRow(lines[start]);
        const bodyLines = lines.slice(start + 2, end);
        const bodyRows = bodyLines.map(splitMarkdownRow);

        // Map each math placeholder to its original LaTeX. Because splitting
        // the table is purely textual, the placeholder indexes remain valid.
        const rowToBlocks = (cells) => cells.map((cell) => ({
            content: (() => {
                const block = paragraphFromRichText(cell, placeholders);
                return block ? [block] : [];
            })()
        }));

        return {
            start,
            end,
            before: lines.slice(0, start).join('\n'),
            table: {
                type: 'table',
                header_rows: 1,
                rows: [
                    { cells: rowToBlocks(headerCells) },
                    ...bodyRows.map((cells) => ({ cells: rowToBlocks(cells) }))
                ]
            },
            after: lines.slice(end).join('\n'),
            placeholders
        };
    };

    const processContentBlocks = (root) => {
        const blocks = [];

        const addParagraphWithMarkdownTables = (paragraph) => {
            const extracted = extractMarkdownTableBlocks(paragraph);

            if (!extracted) {
                const block = paragraphFromNode(paragraph);
                if (block) blocks.push(block);
                return;
            }

            const before = paragraphFromRichText(extracted.before, extracted.placeholders);
            if (before) blocks.push(before);

            blocks.push(extracted.table);

            const after = paragraphFromRichText(extracted.after, extracted.placeholders);
            if (after) blocks.push(after);
        };

        const walk = (node) => {
            if (node.nodeType !== Node.ELEMENT_NODE) return;

            if (node.nodeName === 'TABLE') {
                const table = getTableObj(node);
                if (table) blocks.push(table);
                return;
            }

            if (node.nodeName === 'IMG') {
                blocks.push({
                    type: 'paragraph',
                    inlines: [{ type: 'text', text: '[FIGURE]' }]
                });
                return;
            }

            if (node.nodeName === 'P') {
                addParagraphWithMarkdownTables(node);
                return;
            }

            if (node.nodeName === 'UL' || node.nodeName === 'OL') {
                const items = Array.from(node.children)
                    .filter((el) => el.nodeName === 'LI')
                    .map((li) => ({ inlines: extractInlines(li) }))
                    .filter((item) => item.inlines.length);

                if (items.length) {
                    blocks.push({
                        type: node.nodeName === 'UL' ? 'bullet_list' : 'numbered_list',
                        items
                    });
                }
                return;
            }

            Array.from(node.children).forEach(walk);
        };

        Array.from(root.children).forEach(walk);
        return blocks;
    };

    const getQuestionNumber = (article) => {
        const h2 = article.querySelector('h2[id^="question-"]');
        if (!h2) return null;

        const match = (h2.innerText || h2.textContent || "").match(/\d+/);
        return match ? parseInt(match[0], 10) : null;
    };

    const getOptionContent = (label) => {
        const clone = label.cloneNode(true);
        clone.querySelectorAll("input").forEach((input) => input.remove());
        const inlines = extractInlines(clone);
        return inlines.length ? [{ type: "paragraph", inlines }] : [];
    };

    const getTags = (article) => {
        const h2 = article.querySelector('h2[id^="question-"]');
        const headerRow = h2?.parentElement;
        if (!headerRow) return [];

        const tags = [];

        // The blue topic pill consistently represents the topic hierarchy,
        // but its internal markup varies: some questions use <p>, others use
        // <span>. Reading innerText avoids that implementation detail.
        const topicPill = headerRow.querySelector('[class*="bg-blue-100"]');
        if (topicPill) {
            const topicText = cleanWhitespace(topicPill.innerText || "");
            topicText
                .split(/\s*>\s*/)
                .map(cleanWhitespace)
                .filter(Boolean)
                .forEach((tag) => tags.push(tag));
        }

        // Difficulty is present as a semantic aria-label for every question.
        const difficulty = headerRow.querySelector('[aria-label^="Difficulty:"]');
        if (difficulty) {
            const label = difficulty.getAttribute("aria-label") || "";
            const value = cleanWhitespace(label.replace(/^Difficulty:\s*/i, ""));
            if (value) tags.push(value);
        }

        return [...new Set(tags)];
    };

    const optionNumberToLetter = (value) => {
        const match = String(value || "").match(/Option\s*([1-4])/i);
        return match ? OPTION_LETTERS[parseInt(match[1], 10) - 1] : null;
    };

    const getEmbeddedAnswerMap = () => {
        const scripts = Array.from(document.querySelectorAll("script"));
        const allData = scripts
            .map((s) => s.textContent || "")
            .filter((t) => t.includes("self.__next_f.push"))
            .join("\n");

        const answerMap = {};
        const regex = /"questionNumber":(\d+).*?"correctAnswer":"(.*?)"/g;
        let match;
        while ((match = regex.exec(allData)) !== null) {
            answerMap[match[1]] = match[2];
        }
        return answerMap;
    };

    const getAnswerLetter = (article, qNum, answerMap) => {
        // Prefer the visible answer reveal, scoped to this question. This avoids
        // relying on a CSS class containing Tailwind's escaped ':' character.
        const reveal = article.querySelector('[aria-label^="Reveal correct answer"]');
        if (reveal) {
            const exactOption = Array.from(reveal.querySelectorAll("div"))
                .map((el) => cleanWhitespace(el.innerText || ""))
                .find((text) => /^Option\s*[1-4]$/i.test(text));

            const fromReveal = optionNumberToLetter(exactOption);
            if (fromReveal) return fromReveal;
        }

        // Fallback to the embedded Next.js data when the reveal block is absent.
        return optionNumberToLetter(answerMap[String(qNum)]);
    };

    const getSourceTitle = () => {
        const base = document.title
            .replace(/\s+Past Year Paper with Solutions\s*\|\s*AfterBoards\s*$/i, '')
            .trim();

        const subtitle = document.querySelector('h1 span')?.innerText
            .replace(/\.?\s*Free, no login required\.?\s*$/i, '')
            .trim() || '';

        return `${base} ${subtitle}`
            .toLowerCase()
            .replace(/[|,:]/g, '')
            .replace(/\s+/g, '-')
            .replace(/[^a-z0-9-]/g, '')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '');
    };

    const scrapeEverythingCorrectly = () => {
        const answerMap = getEmbeddedAnswerMap();
        const sourceTitle = getSourceTitle();

        const articles = Array.from(
            document.querySelectorAll('article[id^="question-"]')
        );

        if (!articles.length) {
            throw new Error("No question articles found on the page.");
        }

        return articles
            .map((article) => {
                const qNum = getQuestionNumber(article);
                if (!qNum) return null;

                // Prefer the dedicated inner content container. The outer
                // [aria-labelledby] panel also contains the <fieldset> of answer
                // options, which must NOT be duplicated inside `content`.
                const questionRegion = article.querySelector(
                    '[aria-labelledby^="question-"]'
                );
                const contentBox =
                    questionRegion?.querySelector('.md\\:px-3') || questionRegion;

                const content = contentBox
                    ? processContentBlocks(contentBox)
                    : [];

                const labels = Array.from(
                    article.querySelectorAll('fieldset[aria-label^="Options for question"] label')
                );

                const options = {};
                labels.slice(0, 4).forEach((label, index) => {
                    options[OPTION_LETTERS[index]] = getOptionContent(label);
                });

                return {
                    id: crypto.randomUUID(),
                    type: "MCQ",
                    content,
                    options,
                    answer: getAnswerLetter(article, qNum, answerMap),
                    marks: 1,
                    group_id: null,
                    tags: [...getTags(article), sourceTitle],
                    source: {
                        title: sourceTitle,
                        question_number: qNum
                    },
                    review_status: "NEEDS_REVIEW",
                    publication_status: "DRAFT"
                };
            })
            .filter(Boolean);
    };

    const results = scrapeEverythingCorrectly();
    console.log(`Scraped ${results.length} questions.`);
    const json = JSON.stringify(results, null, 2);

    // Keep the JSON visible in the console
    console.log(json);

    // Automatically download the JSON file
    const filename = `${results[0]?.source?.title || 'questions'}.json`;
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();

    URL.revokeObjectURL(url);
    copy(json);
})();
