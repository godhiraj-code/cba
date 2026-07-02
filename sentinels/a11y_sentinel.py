"""
A11y Sentinel - WCAG 2.1 Accessibility Auditor
Starlight Protocol v1.0.0 Compliant

Passive Sentinel that performs accessibility audits on each pre_check
without blocking test execution. Reports findings via starlight.context.

Author: Dhiraj Das
License: MIT
"""

import asyncio
import json
import re
from datetime import datetime, timezone
import sys
import os

# Add parent directory to path for SDK import
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from sdk.starlight_sdk import SentinelBase


class A11ySentinel(SentinelBase):
    """
    Accessibility Sentinel for WCAG 2.1 AA compliance auditing.
    
    This is a PASSIVE Sentinel:
    - Never blocks test execution (always sends starlight.clear)
    - Reports violations via starlight.context updates
    - Runs with low priority (10) to minimize impact
    
    Capabilities: ["accessibility", "audit", "wcag"]
    """
    
    def __init__(self):
        super().__init__(
            layer_name="A11ySentinel",
            priority=10  # Low priority - runs after other Sentinels
        )
        # CRITICAL: Set capabilities AFTER super().__init__() but they are set
        # on self which is checked by SDK's _register() method
        self.capabilities = ["accessibility", "audit", "wcag"]
        
        # Passive Sentinel - no selectors to monitor (doesn't block on specific elements)
        self.selectors = []
        
        # Audit state
        self.violations = []
        self.passes = 0
        self.audit_count = 0
        self.current_url = None
        
        # WCAG rules registry
        self.rules = [
            self._check_color_contrast,
            self._check_image_alt,
            self._check_form_labels,
            self._check_heading_order,
            self._check_link_names,
            self._check_button_names,
            self._check_focus_indicators,
            self._check_aria_valid,
        ]
        
    async def on_pre_check(self, params, msg_id):
        """
        On each pre_check:
        1. Extract DOM data from pre_check params (Hub sends with each pre_check)
        2. Run accessibility audit
        3. Send violations via starlight.context_update
        4. Always send starlight.clear (non-blocking)
        """
        command = params.get("command", {})
        self.current_url = params.get("url", "unknown")
        
        # Hub provides DOM data in pre_check params (if A11y enabled)
        dom_data = params.get("a11y_snapshot", {"elements": [], "computed": []})
        
        try:
            if dom_data and (dom_data.get("elements") or dom_data.get("computed")):
                # Run all WCAG rules
                violations = []
                passes = 0
                
                for rule_fn in self.rules:
                    try:
                        result = await rule_fn(dom_data)
                        violations.extend(result.get("violations", []))
                        passes += result.get("passes", 0)
                    except Exception as e:
                        print(f"[{self.layer}] Rule error: {e}")
                
                self.violations = violations
                self.passes = passes
                self.audit_count += 1
                
                # Report findings via context_update (protocol compliant)
                if violations:
                    await self._report_violations(violations)
                    print(f"[{self.layer}] Found {len(violations)} accessibility issues")
                else:
                    print(f"[{self.layer}] No accessibility issues found")
            else:
                print(f"[{self.layer}] No A11y snapshot data in pre_check - Hub may not have A11y enabled")
                    
        except Exception as e:
            print(f"[{self.layer}] Audit error: {e}")
        
        # Always clear - accessibility issues do NOT block execution
        await self.send_clear()
        
    async def _request_dom_snapshot(self):
        """Request DOM snapshot from Hub via action."""
        try:
            await self.send_action("get_a11y_snapshot")
            # In a real implementation, we'd wait for the response
            # For now, return mock data for testing
            return {"elements": [], "computed": []}
        except Exception as e:
            print(f"[{self.layer}] DOM snapshot failed: {e}")
            return None
            
    async def _report_violations(self, violations):
        """Send violations to Hub via starlight.context_update (protocol compliant)."""
        score = self._calculate_score(violations)
        
        # Use starlight.context_update format per protocol spec
        context_update = {
            "jsonrpc": "2.0",
            "method": "starlight.context_update",
            "params": {
                "context": {
                    "accessibility": {
                        "timestamp": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
                        "url": self.current_url,
                        "violations": violations,
                        "passes": self.passes,
                        "score": score,
                        "level": self._get_level(score)
                    }
                }
            },
            "id": f"a11y-ctx-{self.audit_count}"
        }
        
        if self._websocket:
            await self._websocket.send(json.dumps(context_update))
            
    def _calculate_score(self, violations):
        """Calculate accessibility score (0-1)."""
        if not violations:
            return 1.0
            
        # Weight by impact
        weights = {"critical": 25, "serious": 15, "moderate": 5, "minor": 1}
        total_deduction = sum(
            weights.get(v.get("impact", "minor"), 1) 
            for v in violations
        )
        
        # Score is percentage of max possible (100 points baseline)
        score = max(0, 100 - total_deduction) / 100
        return round(score, 2)
        
    def _get_level(self, score):
        """Get accessibility level from score."""
        if score >= 0.9:
            return "A (Good)"
        elif score >= 0.7:
            return "B (Acceptable)"
        elif score >= 0.5:
            return "C (Needs Work)"
        else:
            return "D (Critical Issues)"
            
    # ─────────────────────────────────────────────────────────────────
    # WCAG 2.1 AA Rules
    # ─────────────────────────────────────────────────────────────────
    
    async def _check_color_contrast(self, dom_data):
        """
        WCAG 1.4.3 - Minimum Contrast (Level AA)
        Text must have 4.5:1 contrast ratio (3:1 for large text)
        """
        violations = []
        passes = 0
        
        for element in dom_data.get("computed", []):
            styles = element.get("styles", {})
            fg = styles.get("color")
            bg = styles.get("backgroundColor")
            
            if fg and bg and element.get("text"):
                ratio = self._calculate_contrast_ratio(fg, bg)
                font_size = self._parse_font_size(styles.get("fontSize", "16px"))
                
                min_ratio = 3.0 if font_size >= 18 else 4.5
                
                if ratio < min_ratio:
                    violations.append({
                        "rule": "color-contrast",
                        "wcag": "1.4.3",
                        "impact": "serious",
                        "selector": element.get("selector", "unknown"),
                        "message": f"Contrast ratio {ratio:.1f}:1 is below {min_ratio}:1 minimum"
                    })
                else:
                    passes += 1
                    
        return {"violations": violations, "passes": passes}
        
    async def _check_image_alt(self, dom_data):
        """
        WCAG 1.1.1 - Non-text Content (Level A)
        Images must have alt attributes
        """
        violations = []
        passes = 0
        
        for element in dom_data.get("elements", []):
            if element.get("tag") == "IMG":
                alt = element.get("attributes", {}).get("alt")
                
                if alt is None:
                    violations.append({
                        "rule": "image-alt",
                        "wcag": "1.1.1",
                        "impact": "critical",
                        "selector": element.get("selector", "img"),
                        "message": "Image missing alt attribute"
                    })
                elif alt.strip() == "":
                    # Empty alt is OK for decorative images
                    passes += 1
                else:
                    passes += 1
                    
        return {"violations": violations, "passes": passes}
        
    async def _check_form_labels(self, dom_data):
        """
        WCAG 1.3.1 - Info and Relationships (Level A)
        Form inputs must have associated labels
        """
        violations = []
        passes = 0
        
        for element in dom_data.get("elements", []):
            tag = element.get("tag", "").upper()
            
            if tag in ["INPUT", "SELECT", "TEXTAREA"]:
                input_type = element.get("attributes", {}).get("type", "text")
                
                # Skip hidden and submit inputs
                if input_type in ["hidden", "submit", "button", "image"]:
                    continue
                    
                # Check for label
                has_label = (
                    element.get("attributes", {}).get("aria-label") or
                    element.get("attributes", {}).get("aria-labelledby") or
                    element.get("hasLabel", False)
                )
                
                if not has_label:
                    violations.append({
                        "rule": "form-labels",
                        "wcag": "1.3.1",
                        "impact": "serious",
                        "selector": element.get("selector", tag.lower()),
                        "message": f"{tag.lower()} element missing label"
                    })
                else:
                    passes += 1
                    
        return {"violations": violations, "passes": passes}
        
    async def _check_heading_order(self, dom_data):
        """
        WCAG 1.3.1 - Info and Relationships (Level A)
        Headings should follow logical order (h1 -> h2 -> h3)
        """
        violations = []
        passes = 0
        
        headings = []
        for element in dom_data.get("elements", []):
            tag = element.get("tag", "").upper()
            if tag in ["H1", "H2", "H3", "H4", "H5", "H6"]:
                level = int(tag[1])
                headings.append({"level": level, "selector": element.get("selector")})
                
        prev_level = 0
        for heading in headings:
            level = heading["level"]
            
            # First heading should be h1
            if prev_level == 0 and level != 1:
                violations.append({
                    "rule": "heading-order",
                    "wcag": "1.3.1",
                    "impact": "moderate",
                    "selector": heading["selector"],
                    "message": f"First heading should be h1, found h{level}"
                })
            # Shouldn't skip levels
            elif level > prev_level + 1:
                violations.append({
                    "rule": "heading-order",
                    "wcag": "1.3.1",
                    "impact": "moderate",
                    "selector": heading["selector"],
                    "message": f"Heading h{level} skips level (previous was h{prev_level})"
                })
            else:
                passes += 1
                
            prev_level = level
            
        return {"violations": violations, "passes": passes}
        
    async def _check_link_names(self, dom_data):
        """
        WCAG 2.4.4 - Link Purpose (Level A)
        Links must have discernible text
        """
        violations = []
        passes = 0
        
        for element in dom_data.get("elements", []):
            if element.get("tag", "").upper() == "A":
                text = element.get("text", "").strip()
                aria_label = element.get("attributes", {}).get("aria-label")
                
                if not text and not aria_label:
                    violations.append({
                        "rule": "link-name",
                        "wcag": "2.4.4",
                        "impact": "serious",
                        "selector": element.get("selector", "a"),
                        "message": "Link has no accessible name"
                    })
                elif text.lower() in ["click here", "here", "more", "read more"]:
                    violations.append({
                        "rule": "link-name",
                        "wcag": "2.4.4",
                        "impact": "minor",
                        "selector": element.get("selector", "a"),
                        "message": f"Link text '{text}' is not descriptive"
                    })
                else:
                    passes += 1
                    
        return {"violations": violations, "passes": passes}
        
    async def _check_button_names(self, dom_data):
        """
        WCAG 4.1.2 - Name, Role, Value (Level A)
        Buttons must have accessible names
        """
        violations = []
        passes = 0
        
        for element in dom_data.get("elements", []):
            tag = element.get("tag", "").upper()
            role = element.get("attributes", {}).get("role")
            
            if tag == "BUTTON" or role == "button":
                text = element.get("text", "").strip()
                aria_label = element.get("attributes", {}).get("aria-label")
                
                if not text and not aria_label:
                    violations.append({
                        "rule": "button-name",
                        "wcag": "4.1.2",
                        "impact": "critical",
                        "selector": element.get("selector", "button"),
                        "message": "Button has no accessible name"
                    })
                else:
                    passes += 1
                    
        return {"violations": violations, "passes": passes}
        
    async def _check_focus_indicators(self, dom_data):
        """
        WCAG 2.4.7 - Focus Visible (Level AA)
        Interactive elements should have visible focus indicators
        """
        violations = []
        passes = 0
        
        for element in dom_data.get("computed", []):
            tag = element.get("tag", "").upper()
            
            if tag in ["A", "BUTTON", "INPUT", "SELECT", "TEXTAREA"]:
                styles = element.get("styles", {})
                outline = styles.get("outline", "")
                
                # Check if outline is explicitly removed
                if "none" in outline.lower() and not styles.get("boxShadow"):
                    violations.append({
                        "rule": "focus-visible",
                        "wcag": "2.4.7",
                        "impact": "serious",
                        "selector": element.get("selector", tag.lower()),
                        "message": "Focus indicator removed without alternative"
                    })
                else:
                    passes += 1
                    
        return {"violations": violations, "passes": passes}
        
    async def _check_aria_valid(self, dom_data):
        """
        WCAG 4.1.2 - Name, Role, Value (Level A)
        ARIA attributes must be valid
        """
        violations = []
        passes = 0
        
        valid_roles = [
            "alert", "alertdialog", "application", "article", "banner",
            "button", "cell", "checkbox", "columnheader", "combobox",
            "complementary", "contentinfo", "definition", "dialog",
            "directory", "document", "feed", "figure", "form", "grid",
            "gridcell", "group", "heading", "img", "link", "list",
            "listbox", "listitem", "log", "main", "marquee", "math",
            "menu", "menubar", "menuitem", "menuitemcheckbox",
            "menuitemradio", "navigation", "none", "note", "option",
            "presentation", "progressbar", "radio", "radiogroup",
            "region", "row", "rowgroup", "rowheader", "scrollbar",
            "search", "searchbox", "separator", "slider", "spinbutton",
            "status", "switch", "tab", "table", "tablist", "tabpanel",
            "term", "textbox", "timer", "toolbar", "tooltip", "tree",
            "treegrid", "treeitem"
        ]
        
        for element in dom_data.get("elements", []):
            attrs = element.get("attributes", {})
            role = attrs.get("role")
            
            if role and role.lower() not in valid_roles:
                violations.append({
                    "rule": "aria-valid",
                    "wcag": "4.1.2",
                    "impact": "critical",
                    "selector": element.get("selector", "unknown"),
                    "message": f"Invalid ARIA role: '{role}'"
                })
            elif role:
                passes += 1
                
        return {"violations": violations, "passes": passes}
        
    # ─────────────────────────────────────────────────────────────────
    # Utility Functions
    # ─────────────────────────────────────────────────────────────────
    
    def _calculate_contrast_ratio(self, fg_color, bg_color):
        """Calculate contrast ratio between two colors."""
        try:
            fg_lum = self._get_luminance(fg_color)
            bg_lum = self._get_luminance(bg_color)
            
            lighter = max(fg_lum, bg_lum)
            darker = min(fg_lum, bg_lum)
            
            return (lighter + 0.05) / (darker + 0.05)
        except:
            return 21  # Assume passing if can't calculate
            
    def _get_luminance(self, color):
        """Calculate relative luminance of a color."""
        # Parse rgb(r, g, b) format
        match = re.match(r'rgb\((\d+),\s*(\d+),\s*(\d+)\)', color)
        if not match:
            return 0.5
            
        r, g, b = [int(x) / 255 for x in match.groups()]
        
        # Apply gamma correction
        r = r / 12.92 if r <= 0.03928 else ((r + 0.055) / 1.055) ** 2.4
        g = g / 12.92 if g <= 0.03928 else ((g + 0.055) / 1.055) ** 2.4
        b = b / 12.92 if b <= 0.03928 else ((b + 0.055) / 1.055) ** 2.4
        
        return 0.2126 * r + 0.7152 * g + 0.0722 * b
        
    def _parse_font_size(self, size_str):
        """Parse font size string to pixels."""
        match = re.match(r'(\d+(?:\.\d+)?)(px|pt|em|rem)', size_str)
        if not match:
            return 16
            
        value = float(match.group(1))
        unit = match.group(2)
        
        if unit == "pt":
            return value * 1.333
        elif unit in ["em", "rem"]:
            return value * 16
        return value


if __name__ == "__main__":
    sentinel = A11ySentinel()
    asyncio.run(sentinel.start())
