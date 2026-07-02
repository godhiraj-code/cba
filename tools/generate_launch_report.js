#!/usr/bin/env node

/**
 * Generate Starlight commercial launch readiness artifacts.
 *
 * Outputs:
 * - docs/LAUNCH_READINESS_REPORT.md
 * - launcher/launch_readiness.json
 */

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const readJson = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const exists = rel => fs.existsSync(path.join(root, rel));
const listDir = rel => exists(rel) ? fs.readdirSync(path.join(root, rel), { withFileTypes: true }) : [];

function humanizeFileName(file) {
    return file
        .replace(/\.py$|\.js$|\.json$/g, '')
        .replace(/^intent_/, '')
        .replace(/_/g, ' ')
        .replace(/\b\w/g, char => char.toUpperCase());
}

function discoverSentinels() {
    return listDir('sentinels')
        .filter(entry => entry.isFile())
        .map(entry => entry.name)
        .filter(name => name.endsWith('.py'))
        .filter(name => !name.startsWith('__') && !name.startsWith('test_'))
        .sort()
        .map(file => ({
            id: file.replace(/\.py$/, ''),
            name: humanizeFileName(file),
            path: `sentinels/${file}`
        }));
}

function discoverMissions() {
    return listDir('test')
        .filter(entry => entry.isFile())
        .map(entry => entry.name)
        .filter(name => name.startsWith('intent') && name.endsWith('.js'))
        .sort()
        .map(file => ({
            name: humanizeFileName(file),
            path: `test/${file}`
        }));
}

function discoverSdkFolders() {
    return listDir('.')
        .filter(entry => entry.isDirectory())
        .map(entry => entry.name)
        .filter(name => name === 'sdk' || name.endsWith('-sdk'))
        .sort();
}

function discoverSchemas() {
    return listDir('schemas')
        .filter(entry => entry.isFile())
        .map(entry => entry.name)
        .filter(name => name.endsWith('.schema.json'))
        .sort()
        .map(file => `schemas/${file}`);
}

function todayIsoDate(timeZone = process.env.STARLIGHT_REPORT_TIME_ZONE || process.env.TZ || 'Asia/Calcutta') {
    try {
        const parts = new Intl.DateTimeFormat('en-CA', {
            timeZone,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        }).formatToParts(new Date());

        const byType = Object.fromEntries(parts.map(part => [part.type, part.value]));
        return `${byType.year}-${byType.month}-${byType.day}`;
    } catch {
        return new Date().toISOString().slice(0, 10);
    }
}

function buildData() {
    const pkg = readJson('package.json');
    const sentinels = discoverSentinels();
    const missions = discoverMissions();
    const sdks = discoverSdkFolders();
    const schemas = discoverSchemas();

    return {
        generatedAt: todayIsoDate(),
        product: 'Starlight Protocol',
        version: pkg.version,
        verdict: 'Launch as Sentinel/Agent-powered QA reliability, not another generic browser automation framework.',
        productThesis: 'AI and browser automation fail because the script owns every environmental surprise. Starlight separates intent from recovery: the Hub executes goals while specialized Sentinels and future Agents observe, veto, heal, and explain failures.',
        paidWedge: 'Productized AI QA reliability audits and managed Sentinel runs for teams with flaky Playwright/Selenium journeys, AI agents, customer-support chatbots, and high-value browser workflows.',
        icp: [
            'QA managers and SDETs maintaining flaky browser suites',
            'Startups launching AI agents or chatbot workflows that trigger browser actions',
            'Automation/RPA consultants who need reusable recovery agents',
            'Regulated teams needing PII redaction, audit traces, and safe browser orchestration'
        ],
        pricingExperiments: [
            'INR 25k-75k fixed AI/browser automation reliability audit for the first 3 pilots',
            'INR 50k-2L implementation package to add Starlight Sentinels to one critical journey',
            'INR 25k-1L/month managed weekly Sentinel regression runs and launch-readiness reports',
            '$49-$199/month solo/team hosted reporting tier after repeated manual delivery is proven'
        ],
        sentinelAgentStory: 'Sentinels are specialized guard agents around a browser mission: Pulse waits for stability, Janitor clears obstacles, PII protects sensitive data, A11y/Responsive inspect risk, and Vision can interpret visual blockers. Future higher-level Agents can compose Sentinels into business flows while Starlight provides the protocol, trace, and safety rails.',
        cta: [
            'Run the local Mission Control demo and capture a 60-second proof video.',
            'Offer a paid Reliability Audit to 10 QA/startup leads with one concrete browser or AI-agent journey.',
            'Convert repeated audit steps into a hosted Sentinel report before building a broad SaaS.'
        ],
        launchChecklist14Days: [
            'Create one crisp landing page: "AI QA reliability for flaky browser automation and agents."',
            'Record/evidence SauceDemo, Salesforce, and portfolio flows with Sentinels visibly clearing/waiting/recovering. See docs/PROTOCOL_OBJECTIVE_EVIDENCE.md.',
            'Publish a pricing pilot: audit, implementation package, managed weekly runs.',
            'Write 3 LinkedIn posts showing before/after flaky automation traces.',
            'DM 50 QA managers, founders, and automation consultants with a paid pilot offer.',
            'Collect 2 anonymized case studies and one testimonial before expanding scope.'
        ],
        discovered: {
            sentinels,
            missions,
            sdks,
            schemas
        },
        counts: {
            sentinels: sentinels.length,
            missions: missions.length,
            sdks: sdks.length,
            schemas: schemas.length
        }
    };
}

function bullet(items) {
    return items.map(item => `- ${item}`).join('\n');
}

function table(rows, columns) {
    const header = `| ${columns.join(' | ')} |`;
    const sep = `| ${columns.map(() => '---').join(' | ')} |`;
    const body = rows.map(row => `| ${columns.map(col => row[col] || '').join(' | ')} |`).join('\n');
    return [header, sep, body].join('\n');
}

function renderMarkdown(data) {
    return `# Starlight Protocol Launch Readiness Report

Generated: ${data.generatedAt}
Version: ${data.version}

## Verdict

${data.verdict}

## Product thesis

${data.productThesis}

## Paid wedge

${data.paidWedge}

## Ideal customer profile

${bullet(data.icp)}

## Pricing experiments

${bullet(data.pricingExperiments)}

## Sentinel / Agent story

${data.sentinelAgentStory}

## Discovered product surface

- Sentinels: ${data.counts.sentinels}
- Demo missions: ${data.counts.missions}
- SDK folders: ${data.counts.sdks}
- Protocol schemas: ${data.counts.schemas}

### Sentinels

${table(data.discovered.sentinels, ['name', 'path'])}

### Demo missions

${table(data.discovered.missions, ['name', 'path'])}

### SDK folders

${bullet(data.discovered.sdks)}

## 3-step launch CTA

${data.cta.map((item, index) => `${index + 1}. ${item}`).join('\n')}

## Next 14-day launch checklist

${data.launchChecklist14Days.map((item, index) => `- [${index === 1 ? 'x' : ' '}] ${item}`).join('\n')}
`;
}

function main() {
    const data = buildData();
    const docsDir = path.join(root, 'docs');
    const launcherDir = path.join(root, 'launcher');
    fs.mkdirSync(docsDir, { recursive: true });
    fs.mkdirSync(launcherDir, { recursive: true });

    const mdPath = path.join(docsDir, 'LAUNCH_READINESS_REPORT.md');
    const jsonPath = path.join(launcherDir, 'launch_readiness.json');
    fs.writeFileSync(mdPath, renderMarkdown(data), 'utf8');
    fs.writeFileSync(jsonPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');

    console.log(`Launch readiness report written: ${path.relative(root, mdPath)}`);
    console.log(`Mission Control JSON written: ${path.relative(root, jsonPath)}`);
    console.log(`Discovered ${data.counts.sentinels} sentinels, ${data.counts.missions} missions, ${data.counts.sdks} SDK folders, ${data.counts.schemas} schemas.`);
}

if (require.main === module) {
    main();
}

module.exports = { buildData, renderMarkdown };
