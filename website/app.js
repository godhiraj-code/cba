'use strict';

const labels = { success: 'Verified artifact', constraintFailure: 'Constraint failure', verificationFailure: 'Rejected claim',
    cancellation: 'Cancellation', remote: 'Remote agent', recovery: 'Fresh recovery' };

function renderReport(report, artifact) {
    const summary = document.querySelector('#run-summary');
    summary.replaceChildren();
    const line = document.createElement('div');
    line.className = 'run-line';
    const badge = document.createElement('span');
    badge.className = 'status ' + report.status;
    badge.textContent = report.status;
    const title = document.createElement('p');
    title.textContent = report.goal;
    line.append(badge, title);
    const id = document.createElement('p');
    id.className = 'run-id';
    id.textContent = 'Run ' + report.id;
    const scroll = document.createElement('div');
    scroll.className = 'table-scroll';
    const table = document.createElement('table');
    table.innerHTML = '<thead><tr><th scope="col">Step</th><th scope="col">Agent</th><th scope="col">Status</th><th scope="col">Attempts</th></tr></thead><tbody></tbody>';
    for (const step of report.steps) {
        const row = document.createElement('tr');
        const attempts = step.result?.attempts || step.error?.details?.attempts || [];
        for (const value of [step.goal, step.result?.sentinel?.name || attempts.at(-1)?.sentinel?.name || 'See error details', step.status, attempts.length]) {
            const cell = document.createElement('td');
            cell.textContent = value;
            row.append(cell);
        }
        table.querySelector('tbody').append(row);
    }
    scroll.append(table);
    summary.append(line, id, scroll);
    const detail = document.createElement('p');
    const value = report.steps.at(-1)?.result?.value;
    detail.textContent = report.error ? report.error.message : value?.path
        ? 'Verified file contents: ' + artifact.trim().replaceAll('\n', ' · ') : 'Result: ' + JSON.stringify(value);
    summary.append(detail);
    document.querySelector('#run-json').textContent = JSON.stringify(report, null, 2);
}

async function loadDemo() {
    const revision = document.querySelector('meta[name="starlight-release"]')?.content || 'development';
    const response = await fetch('assets/demo-transcript.json?v=' + encodeURIComponent(revision));
    if (!response.ok) throw new Error('Recorded results are unavailable. Download the video or try again later.');
    const data = await response.json();
    const scenarios = document.querySelector('#scenarios');
    for (const [key, label] of Object.entries(labels)) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = label;
        button.setAttribute('aria-pressed', String(key === 'success'));
        button.addEventListener('click', () => {
            for (const sibling of scenarios.children) sibling.setAttribute('aria-pressed', String(sibling === button));
            renderReport(data.reports[key], data.artifact);
        });
        scenarios.append(button);
    }
    renderReport(data.reports.success, data.artifact);
    let time = 0;
    for (const scene of data.scenes) {
        const seek = time;
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = `${Math.floor(time / 60)}:${String(time % 60).padStart(2, '0')} ${scene.title.replace(/^\d+ \/ /, '')}`;
        button.addEventListener('click', () => {
            const video = document.querySelector('#walkthrough');
            video.currentTime = seek;
            video.focus();
            video.play().catch(() => { /* Native play controls remain available. */ });
        });
        document.querySelector('#chapters').append(button);
        time += scene.seconds;
    }
}
loadDemo().catch(error => { document.querySelector('#run-summary').textContent = error.message; });
