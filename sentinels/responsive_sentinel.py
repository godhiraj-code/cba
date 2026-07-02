"""
Responsive Sentinel - Viewport-Aware Obstacle Detection
Starlight Protocol v1.3.0 Phase 14.2

Detects and handles mobile-specific UI obstacles such as:
- Hamburger menus blocking content
- Sticky footers covering interactive elements  
- App install banners
- Mobile-only popups

Author: Dhiraj Das
License: MIT
"""

import asyncio
import json
import sys
import os

# Add parent directory to path for SDK import
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from sdk.starlight_sdk import SentinelBase


class ResponsiveSentinel(SentinelBase):
    """
    Viewport-aware Sentinel for mobile-specific obstacle detection.
    
    Capabilities: ["responsive", "mobile", "detection"]
    Priority: 6 (Medium - after Pulse, before Data)
    """
    
    def __init__(self):
        super().__init__(
            layer_name="ResponsiveSentinel",
            priority=6
        )
        self.capabilities = ["responsive", "mobile", "detection"]
        
        # Mobile-specific blocking patterns
        self.mobile_patterns = [
            # Navigation overlays
            ".mobile-menu",
            ".hamburger-menu", 
            "[data-mobile-nav]",
            ".mobile-nav-overlay",
            ".nav-drawer",
            ".side-menu.open",
            
            # Sticky elements that cover content
            ".sticky-footer.visible",
            ".fixed-bottom-bar",
            ".app-install-banner",
            ".smart-app-banner",
            
            # Mobile popups
            ".mobile-popup",
            ".mobile-modal",
            "[data-mobile-only]",
            ".download-app-modal",
            
            # Cookie/consent on mobile
            ".mobile-cookie-banner",
            ".bottom-sheet.consent"
        ]
        
        # Close button patterns for mobile overlays
        self.close_patterns = [
            ".mobile-menu-close",
            ".hamburger-close",
            "[data-close-nav]",
            ".banner-dismiss",
            ".close-app-banner",
            "button[aria-label*='close']",
            "button[aria-label*='dismiss']"
        ]
        
        # Track viewport for mobile detection
        self.current_viewport = {"width": 1920, "height": 1080}
        self.is_mobile_viewport = False
        
    async def on_pre_check(self, params, msg_id):
        """
        On each pre_check:
        1. Check if viewport indicates mobile (width < 768)
        2. Scan for mobile-specific blockers
        3. Hijack and clear if blocking detected
        4. Send clear otherwise
        """
        command = params.get("command", {})
        
        # Extract viewport info from pre_check params
        viewport = params.get("viewport", {})
        self.current_viewport = viewport
        self.is_mobile_viewport = viewport.get("width", 1920) < 768
        
        if not self.is_mobile_viewport:
            # Not a mobile viewport - skip mobile-specific checks
            await self.send_clear()
            return
            
        print(f"[{self.layer}] 📱 Mobile viewport detected ({viewport.get('width', '?')}x{viewport.get('height', '?')})")
        
        # Check for mobile-specific blockers in pre_check elements
        elements = params.get("blocking", [])
        
        for pattern in self.mobile_patterns:
            for element in elements:
                selector = element.get("selector", "")
                if self._matches_pattern(selector, pattern):
                    visible = element.get("visible", False)
                    if visible:
                        print(f"[{self.layer}] 🚧 Mobile blocker detected: {pattern}")
                        await self.send_hijack(f"Mobile obstacle: {pattern}")
                        
                        # Try to close the blocker
                        closed = await self._try_close_blocker(pattern)
                        
                        if closed:
                            print(f"[{self.layer}] ✓ Mobile blocker cleared")
                        else:
                            print(f"[{self.layer}] ⚠ Could not auto-clear blocker, hiding element")
                            await self.send_action("remove", pattern)
                        
                        await self.send_resume(re_check=True)
                        return
        
        # No blockers found
        await self.send_clear()
        
    def _matches_pattern(self, selector: str, pattern: str) -> bool:
        """Check if selector matches pattern (simple substring match)."""
        # Remove special chars for comparison
        pattern_clean = pattern.replace(".", "").replace("#", "").replace("[", "").replace("]", "")
        return pattern_clean.lower() in selector.lower()
        
    async def _try_close_blocker(self, blocker_pattern: str) -> bool:
        """Attempt to close a mobile blocker using known close patterns."""
        for close_pattern in self.close_patterns:
            try:
                await self.send_action("click", close_pattern)
                await asyncio.sleep(0.3)  # Wait for animation
                return True
            except:
                continue
        return False
        
    async def on_entropy(self, params):
        """Track viewport changes from entropy stream."""
        viewport = params.get("viewport")
        if viewport:
            self.current_viewport = viewport
            self.is_mobile_viewport = viewport.get("width", 1920) < 768


if __name__ == "__main__":
    sentinel = ResponsiveSentinel()
    asyncio.run(sentinel.start())
