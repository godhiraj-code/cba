"""
PII Sentinel - Privacy & Compliance Guardian (v2.7)
Part of the Starlight Protocol - Phase 9: Sovereign Security

Detects Personally Identifiable Information (PII) in the browser before
screenshots are taken, ensuring compliance with GDPR, HIPAA, and PCI-DSS.
"""

import asyncio
import re
import sys
import os

# Path boilerplate for local imports
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from sdk.starlight_sdk import SentinelBase

class PIISentinel(SentinelBase):
    def __init__(self):
        super().__init__(layer_name="PIISentinel", priority=2)  # High priority - security first
        self.capabilities = ["pii-detection", "compliance"]
        
        # Load PII config
        pii_config = self.config.get("pii", {})
        self.mode = pii_config.get("mode", "alert")  # "alert", "block", or "redact"
        self.patterns = self._compile_patterns(pii_config.get("patterns", {}))
        self.detected_pii = []
        
    def _compile_patterns(self, custom_patterns):
        """Compile regex patterns for PII detection."""
        # Default patterns for common PII types
        default_patterns = {
            "email": r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b',
            "ssn": r'\b\d{3}-\d{2}-\d{4}\b',
            "credit_card": r'\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13}|6(?:011|5[0-9]{2})[0-9]{12})\b',
            "phone_us": r'\b(?:\+1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b',
            "ip_address": r'\b(?:\d{1,3}\.){3}\d{1,3}\b',
            "date_of_birth": r'\b(?:0[1-9]|1[0-2])[/-](?:0[1-9]|[12]\d|3[01])[/-](?:19|20)\d{2}\b',
        }
        
        # Merge with custom patterns
        all_patterns = {**default_patterns, **custom_patterns}
        
        compiled = {}
        for name, pattern in all_patterns.items():
            try:
                compiled[name] = re.compile(pattern, re.IGNORECASE)
            except re.error as e:
                print(f"[{self.layer}] Warning: Invalid regex for {name}: {e}")
        
        return compiled
    
    def scan_for_pii(self, text):
        """Scan text for PII patterns. Returns list of findings."""
        findings = []
        
        for pii_type, pattern in self.patterns.items():
            matches = pattern.findall(text)
            for match in matches:
                findings.append({
                    "type": pii_type,
                    "value": self._redact(match),  # Never log actual PII
                    "raw_length": len(match)
                })
        
        return findings
    
    def _redact(self, value):
        """Redact sensitive value for logging."""
        if len(value) <= 4:
            return "****"
        return value[:2] + "*" * (len(value) - 4) + value[-2:]
    
    async def on_pre_check(self, params, msg_id):
        """Scan page content for PII before execution."""
        self.detected_pii = []
        
        # Get page text from blocking elements or request page scan
        blocking = params.get("blocking", [])
        page_text = params.get("page_text", "")
        
        # Scan any text content we have access to
        all_text = page_text
        for element in blocking:
            all_text += " " + element.get("text", "")
        
        if all_text.strip():
            findings = self.scan_for_pii(all_text)
            
            if findings:
                self.detected_pii = findings
                types_found = list(set(f["type"] for f in findings))
                
                print(f"[{self.layer}] ⚠️  PII DETECTED: {len(findings)} instances of {types_found}")
                
                if self.mode == "block":
                    print(f"[{self.layer}] 🚫 BLOCKING execution - PII found in page")
                    await self._log_pii_event(findings, blocked=True)
                    await self.send_wait(
                        retry_after_ms=0,
                        severity="hard",
                        reason=f"PII Compliance Block: {types_found}"
                    )
                    return
                elif self.mode == "alert":
                    print(f"[{self.layer}] ⚠️  ALERT: Proceeding with PII warning")
                    await self._log_pii_event(findings, blocked=False)
        
        # Clear for execution
        await self.send_clear()
    
    async def _log_pii_event(self, findings, blocked):
        """Log PII detection event to sovereign context."""
        event = {
            "pii_detected": True,
            "pii_count": len(findings),
            "pii_types": list(set(f["type"] for f in findings)),
            "action_taken": "blocked" if blocked else "alerted",
            "compliance_mode": self.mode
        }
        await self.update_context({"security": event})
    
    async def on_message(self, method, params, msg_id):
        """Track command completion for audit logging."""
        if isinstance(params, dict) and params.get("type") == "COMMAND_COMPLETE":
            if self.detected_pii:
                print(f"[{self.layer}] 📋 Audit: Command completed with {len(self.detected_pii)} PII warnings")
                self.detected_pii = []

if __name__ == "__main__":
    sentinel = PIISentinel()
    asyncio.run(sentinel.start())
