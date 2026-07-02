/**
 * Starlight NLI - Self-Documenting Missions
 * 
 * Phase 13: Natural Language Intent
 * 
 * Generates Gherkin .feature files from successful mission traces.
 * Auto-documents what the test did in BDD format.
 */

const fs = require('fs');
const path = require('path');

class MissionDocumenter {
    constructor() {
        this.outputDir = './generated_scenarios';
    }

    /**
     * Generate a .feature file from mission trace.
     * @param {string} tracePath - Path to mission_trace.json
     * @param {string} outputName - Output feature file name (without .feature)
     * @returns {string} - Generated feature content
     */
    generateFromTrace(tracePath, outputName = 'generated') {
        const trace = JSON.parse(fs.readFileSync(tracePath, 'utf-8'));
        return this.generate(trace, outputName);
    }

    /**
     * Generate feature content from trace object.
     * @param {object} trace - Mission trace object
     * @param {string} name - Feature/scenario name
     */
    generate(trace, name = 'Generated Test') {
        const events = trace.events || trace;
        const steps = [];

        // Extract relevant events
        for (const event of events) {
            const step = this._eventToStep(event);
            if (step) {
                steps.push(step);
            }
        }

        // Deduplicate consecutive identical steps
        const deduped = this._deduplicateSteps(steps);

        // Build feature content
        const feature = this._buildFeature(name, deduped);
        return feature;
    }

    /**
     * Convert a trace event to a Gherkin step.
     * @private
     */
    _eventToStep(event) {
        const { type, command, cmd, url, goal, text, selector, name, value } = event;

        // Skip non-command events
        if (type !== 'command' && type !== 'intent') {
            return null;
        }

        const actualCmd = cmd || command;

        switch (actualCmd) {
            case 'goto':
                return `Given I am on "${url}"`;

            case 'fill': {
                const field = goal || this._selectorToLabel(selector) || 'field';
                return `When I fill "${field}" with "${text || value || ''}"`;
            }

            case 'click': {
                const target = goal || this._selectorToLabel(selector) || 'element';
                return `When I click "${target}"`;
            }

            case 'select': {
                const dropdown = goal || this._selectorToLabel(selector) || 'dropdown';
                return `When I select "${value}" from "${dropdown}"`;
            }

            case 'check':
                return `When I check "${goal || selector}"`;

            case 'uncheck':
                return `When I uncheck "${goal || selector}"`;

            case 'hover':
                return `When I hover over "${goal || selector}"`;

            case 'checkpoint':
                return `Then I should see "${name}"`;

            case 'screenshot':
                return `And I take a screenshot "${name || 'screenshot'}"`;

            default:
                return null;
        }
    }

    /**
     * Convert selector to human-readable label.
     * @private
     */
    _selectorToLabel(selector) {
        if (!selector) return null;

        // Extract from common patterns
        const idMatch = selector.match(/#([a-zA-Z0-9_-]+)/);
        if (idMatch) {
            return this._humanize(idMatch[1]);
        }

        const classMatch = selector.match(/\.([a-zA-Z0-9_-]+)/);
        if (classMatch) {
            return this._humanize(classMatch[1]);
        }

        // has-text pattern
        const textMatch = selector.match(/:has-text\("([^"]+)"\)/);
        if (textMatch) {
            return textMatch[1];
        }

        return selector;
    }

    /**
     * Convert kebab/snake case to human readable.
     * @private
     */
    _humanize(str) {
        return str
            .replace(/[-_]/g, ' ')
            .replace(/([a-z])([A-Z])/g, '$1 $2')
            .toLowerCase()
            .replace(/\b\w/g, c => c.toUpperCase());
    }

    /**
     * Remove consecutive duplicate steps.
     * @private
     */
    _deduplicateSteps(steps) {
        return steps.filter((step, i) => i === 0 || step !== steps[i - 1]);
    }

    /**
     * Build complete feature file content.
     * @private
     */
    _buildFeature(name, steps) {
        const lines = [
            `Feature: ${name}`,
            '',
            `  Scenario: ${name}`,
        ];

        // Convert first step to Given if it's not already
        for (let i = 0; i < steps.length; i++) {
            let step = steps[i];

            // First step should be Given
            if (i === 0 && !step.startsWith('Given')) {
                step = step.replace(/^When|^Then|^And/, 'Given');
            }
            // Subsequent Given becomes And
            else if (i > 0 && step.startsWith('Given')) {
                step = step.replace('Given', 'And');
            }
            // Use And for consecutive When steps
            else if (i > 0 && step.startsWith('When') &&
                steps[i - 1].startsWith('When')) {
                step = step.replace('When', 'And');
            }

            lines.push(`    ${step}`);
        }

        return lines.join('\n');
    }

    /**
     * Save generated feature to file.
     * @param {string} content - Feature content
     * @param {string} filename - Output filename (without .feature)
     */
    save(content, filename) {
        if (!fs.existsSync(this.outputDir)) {
            fs.mkdirSync(this.outputDir, { recursive: true });
        }

        const outputPath = path.join(this.outputDir, `${filename}.feature`);
        fs.writeFileSync(outputPath, content, 'utf-8');
        console.log(`[NLI] Generated feature file: ${outputPath}`);
        return outputPath;
    }
}

module.exports = { MissionDocumenter };
