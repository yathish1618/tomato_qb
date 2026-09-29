#!/usr/bin/env node

/**
 * Validate the actual JavaScript strings produced by JSON parsing using
 * MathJax 3's TeX parser.
 *
 * This is intentionally aligned with the Question Bank frontend:
 *   inlineMath  = $, \( ... \)
 *   displayMath = $$, \[ ... \]
 *   processEscapes = true
 *   processEnvironments = true
 *   processRefs = true
 *
 * Usage:
 *   node validate_mathjax_bundle.js /path/to/bundle /path/to/errors.csv
 *
 * The bundle should contain:
 *   questions/<UUID>/question.json
 *   groups/<UUID>/group.json
 *
 * npm dependency:
 *   mathjax-full 3.2.2
 */

const fs = require("fs");
const path = require("path");

const { mathjax } = require("mathjax-full/js/mathjax.js");
const { TeX } = require("mathjax-full/js/input/tex.js");
const { SVG } = require("mathjax-full/js/output/svg.js");
const { FindTeX } = require("mathjax-full/js/input/tex/FindTeX.js");
const { AllPackages } = require("mathjax-full/js/input/tex/AllPackages.js");
const { liteAdaptor } = require("mathjax-full/js/adaptors/liteAdaptor.js");
const { RegisterHTMLHandler } = require("mathjax-full/js/handlers/html.js");

const adaptor = liteAdaptor();
RegisterHTMLHandler(adaptor);

const inputJax = new TeX({
    packages: AllPackages,
    processEscapes: true,
    processEnvironments: true,
    processRefs: true,
});

const outputJax = new SVG({ fontCache: "none" });

const document = mathjax.document("", {
    InputJax: inputJax,
    OutputJax: outputJax,
});

const finder = new FindTeX({
    inlineMath: [
        ["$", "$"],
        ["\\(", "\\)"],
    ],
    displayMath: [
        ["$$", "$$"],
        ["\\[", "\\]"],
    ],
    processEscapes: true,
    processEnvironments: true,
    processRefs: true,
});

function decodeHtmlAttribute(value) {
    return value
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, "&")
        .replace(/&#39;/g, "'")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">");
}

function validateText(text) {
    const matches = finder.findMath([String(text)]);
    const errors = [];

    for (const item of matches) {
        try {
            const node = document.convert(item.math, {
                display: !!item.display,
            });

            const html = adaptor.outerHTML(node);
            const errorMatches = [
                ...html.matchAll(/data-mjx-error="([^"]*)"/g),
            ];

            for (const match of errorMatches) {
                errors.push({
                    expression: item.math,
                    display: !!item.display,
                    error: decodeHtmlAttribute(match[1]),
                });
            }
        } catch (error) {
            errors.push({
                expression: item.math,
                display: !!item.display,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    return {
        mathCount: matches.length,
        errors,
    };
}

function csvEscape(value) {
    const s = value == null ? "" : String(value);
    return `"${s.replace(/"/g, '""')}"`;
}

function walkJsonFiles(dir) {
    const results = [];

    function walk(current) {
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
            const full = path.join(current, entry.name);

            if (entry.isDirectory()) {
                walk(full);
            } else if (
                entry.isFile() &&
                (entry.name === "question.json" || entry.name === "group.json")
            ) {
                results.push(full);
            }
        }
    }

    walk(dir);
    return results.sort();
}

function fieldsForRecord(data, isGroup) {
    const fields = [];

    if (isGroup) {
        if (typeof data.content === "string") {
            fields.push(["content", data.content]);
        }
        if (typeof data.question === "string") {
            fields.push(["question", data.question]);
        }
    } else {
        if (typeof data.question === "string") {
            fields.push(["question", data.question]);
        }

        if (data.options && typeof data.options === "object") {
            for (const label of ["A", "B", "C", "D"]) {
                if (typeof data.options[label] === "string") {
                    fields.push([`options.${label}`, data.options[label]]);
                }
            }
        }

        if (typeof data.solution === "string") {
            fields.push(["solution", data.solution]);
        }
    }

    return fields;
}

function parseArgs(argv) {
    if (argv.length < 2) {
        console.error(
            "Usage: node validate_mathjax_bundle.js <bundle-dir> <output.csv>"
        );
        process.exit(2);
    }

    return {
        bundleDir: path.resolve(argv[0]),
        outputCsv: path.resolve(argv[1]),
    };
}

function main() {
    const { bundleDir, outputCsv } = parseArgs(process.argv.slice(2));

    if (!fs.existsSync(bundleDir)) {
        throw new Error(`Bundle directory not found: ${bundleDir}`);
    }

    const files = walkJsonFiles(bundleDir);
    const rows = [
        [
            "record_type",
            "uuid",
            "question_number",
            "field",
            "display",
            "expression",
            "error",
            "file",
        ],
    ];

    let mathExpressions = 0;
    let errorCount = 0;
    let recordCountWithErrors = 0;
    const recordsWithErrors = new Set();

    for (const file of files) {
        let data;

        try {
            data = JSON.parse(fs.readFileSync(file, "utf8"));
        } catch (error) {
            console.error(`Could not parse ${file}: ${error.message}`);
            continue;
        }

        const isGroup = path.basename(file) === "group.json";
        const recordType = isGroup ? "group" : "question";
        const uuid = data.id || path.basename(path.dirname(file));
        const questionNumber = isGroup
            ? (data.question_number ?? "")
            : (data.source?.question_number ?? "");

        for (const [field, value] of fieldsForRecord(data, isGroup)) {
            const result = validateText(value);
            mathExpressions += result.mathCount;

            for (const err of result.errors) {
                errorCount += 1;
                recordsWithErrors.add(uuid);

                rows.push([
                    recordType,
                    uuid,
                    questionNumber,
                    field,
                    err.display ? "display" : "inline",
                    err.expression,
                    err.error,
                    file,
                ]);
            }
        }
    }

    recordCountWithErrors = recordsWithErrors.size;

    fs.mkdirSync(path.dirname(outputCsv), { recursive: true });

    const csv = rows
        .map(row => row.map(csvEscape).join(","))
        .join("\n") + "\n";

    fs.writeFileSync(outputCsv, csv, "utf8");

    console.log(`Files scanned: ${files.length}`);
    console.log(`Math expressions checked: ${mathExpressions}`);
    console.log(`Error occurrences: ${errorCount}`);
    console.log(`Records with errors: ${recordCountWithErrors}`);
    console.log(`CSV: ${outputCsv}`);
}

main();
