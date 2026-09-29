js
const scrapeEverythingCorrectly = () => {
    // 1. Fetch Metadata (Answers)
    const scripts = Array.from(document.querySelectorAll('script')).filter(s => s.textContent.includes('self.__next_f.push'));
    const allDataStr = scripts.map(s => s.textContent).join('');
    const answerMap = {};
    const questionRegex = /"questionNumber":(\d+),.*?"correctAnswer":"(.*?)"/g;
    let match;
    while ((match = questionRegex.exec(allDataStr)) !== null) {
        answerMap[match[1]] = match[2];
    }

    // 1. Find all "Correct Answer" reveal blocks on the page
    // These are usually in pairs: [ "Option X", "Correct Answer" ]
    const revealBlocks = Array.from(document.querySelectorAll('.group-hover\\:-translate-y-full'))
        .filter(el => el.innerText.includes('Correct Answer'));

    // Map the correct options by their order on the page
    const correctOptions = revealBlocks.map(indicator => {
        const sibling = indicator.previousElementSibling;
        return sibling ? sibling.innerText.trim() : null; // Returns "Option 1", "Option 2", etc.
    });

    // 2. Helper: Enhanced Math/Text Processor
    const getCleanText = (node) => {
        let clone = node.cloneNode(true);
        clone.querySelectorAll('.katex').forEach(k => {
            const latex = k.querySelector('annotation[encoding="application/x-tex"]');
            if (latex) k.outerHTML = ` $${latex.textContent.trim()}$ `;
        });
        return clone.innerText.trim().replace(/\s+/g, ' ');
    };

    // 3. Helper: Table Extractor
    const getTableObj = (table, id) => {
        const rows = Array.from(table.querySelectorAll('tr'));
        if (!rows.length) return null;
        const headers = Array.from(rows[0].querySelectorAll('th, td')).map(c => getCleanText(c));
        const dataRows = rows.slice(1).map(r => Array.from(r.querySelectorAll('td')).map(c => getCleanText(c)));
        return { type: "table", id: `table-${id}`, headers, rows: dataRows };
    };

    // 4. Main Loop
    return Array.from(document.querySelectorAll('.my-3.rounded-2xl.border-neutral-200')).map((container, qIdx) => {
        const header = container.querySelector('.md\\:px-6.md\\:pt-5');
        const body = container.querySelector('.mt-4.flex.flex-col');
        const contentBox = body?.querySelector('.md\\:px-3');
        const qNum = header?.querySelector('h2')?.innerText.replace(/[^\d]/g, '');

        let contents = [];
        let tableIdx = 1;

        if (contentBox) {
            const addText = (val) => {
                if (!val) return;
                let last = contents[contents.length - 1];
                if (last && last.type === "text") { last.value += " " + val; }
                else { contents.push({ type: "text", value: val }); }
            };

            // Recursive function to handle deep nesting in questions like Q26/Q83
            const processNode = (node) => {
                if (node.nodeName === 'TABLE') {
                    contents.push(getTableObj(node, tableIdx++));
                } else if (node.nodeName === 'IMG') {
                    contents.push({ type: "figure", id: `fig-${qNum}-${tableIdx}`, src: node.src });
                } else if (node.nodeType === Node.ELEMENT_NODE) {
                    // If it's a container with a table inside, we MUST go deeper
                    if (node.querySelector('table')) {
                        Array.from(node.childNodes).forEach(processNode);
                    } 
                    // If it's a math block or plain container, treat as text
                    else {
                        addText(getCleanText(node));
                    }
                } else if (node.nodeType === Node.TEXT_NODE) {
                    addText(node.textContent.trim());
                }
            };
            Array.from(contentBox.childNodes).forEach(processNode);
        }

        // Options & Answer Value
        const labels = Array.from(body?.querySelectorAll('label') || []);
        const rawOptions = labels.map(l => getCleanText(l));
        const options = {};
        rawOptions.forEach((o, i) => options[String.fromCharCode(65 + i)] = o);
        
        const correctIdx = answerMap[qNum];
        // const answerVal = correctIdx ? rawOptions[parseInt(correctIdx) - 1] : null;
        const answerVal = correctOptions[parseInt(qNum)-1] || "Unknown";

        return {
            id: crypto.randomUUID(),
            type: "MCQ",
            content: contents,
            options: options,
            answer: answerVal,
            tags: Array.from(header?.querySelectorAll('.latex-wrapper p, p.bg-emerald-100') || []).map(p => p.innerText.trim()),
            source: { title: document.title, question_number: parseInt(qNum) },
            review_status: "NEEDS_REVIEW",
            publication_status: "DRAFT"
        };
    });
};

console.log(JSON.stringify(scrapeEverythingCorrectly(), null, 2));
