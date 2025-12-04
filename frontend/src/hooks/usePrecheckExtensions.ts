import { useState, useCallback, useRef } from "react";

// ============================================================================
// Types
// ============================================================================

export type ExtensionCategory = 
  | "screen_recorder"
  | "automation"
  | "clipboard_manager"
  | "devtools"
  | "ad_blocker"
  | "remote_desktop"
  | "unknown";

export type ConfidenceLevel = "high" | "medium" | "low";

export interface DetectedExtension {
  id: string;
  category: ExtensionCategory;
  signature: string;
  confidence: ConfidenceLevel;
  description: string;
}

export interface ExtensionScanResult {
  extensions: DetectedExtension[];
  hasHighRisk: boolean; // Screen recorders, automation, remote desktop
  hasMediumRisk: boolean;
  hasAnyExtension: boolean;
  hasHarmfulExtension: boolean; // Only block if harmful extension detected
  scanTime: number;
}

interface UsePrecheckExtensionsReturn {
  isScanning: boolean;
  scanResult: ExtensionScanResult | null;
  error: string | null;
  scan: () => Promise<ExtensionScanResult>;
  reportWarning: (assessmentId: string, userId: string) => Promise<void>;
}

// ============================================================================
// Detection Signatures
// ============================================================================

interface GlobalVarSignature {
  name: string;
  category: ExtensionCategory;
  confidence: ConfidenceLevel;
  description: string;
}

const GLOBAL_VAR_SIGNATURES: GlobalVarSignature[] = [
  // Screen recorders
  { name: "__OBSPLUGIN__", category: "screen_recorder", confidence: "high", description: "OBS Browser Plugin" },
  { name: "ScreenRecorder", category: "screen_recorder", confidence: "high", description: "Screen Recorder Extension" },
  { name: "__screenCaptureEnabled__", category: "screen_recorder", confidence: "high", description: "Screen Capture API" },
  { name: "screencastify", category: "screen_recorder", confidence: "high", description: "Screencastify" },
  { name: "__loom__", category: "screen_recorder", confidence: "high", description: "Loom Screen Recorder" },
  
  // Remote Desktop / Screen Sharing (HIGH RISK)
  { name: "AnyDesk", category: "remote_desktop", confidence: "high", description: "AnyDesk Remote Desktop" },
  { name: "__anydesk__", category: "remote_desktop", confidence: "high", description: "AnyDesk Remote Desktop" },
  { name: "TeamViewer", category: "remote_desktop", confidence: "high", description: "TeamViewer" },
  { name: "__teamviewer__", category: "remote_desktop", confidence: "high", description: "TeamViewer" },
  { name: "RemoteDesktop", category: "remote_desktop", confidence: "high", description: "Remote Desktop App" },
  { name: "__chrome_remote_desktop__", category: "remote_desktop", confidence: "high", description: "Chrome Remote Desktop" },
  { name: "parsec", category: "remote_desktop", confidence: "high", description: "Parsec Remote Desktop" },
  { name: "rustdesk", category: "remote_desktop", confidence: "high", description: "RustDesk Remote Desktop" },
  
  // Clipboard managers
  { name: "_clipboardJS", category: "clipboard_manager", confidence: "medium", description: "Clipboard.js Extension" },
  { name: "__CLIP__", category: "clipboard_manager", confidence: "medium", description: "Clipboard Extension" },
  
  // DevTools
  { name: "__REACT_DEVTOOLS_GLOBAL_HOOK__", category: "devtools", confidence: "low", description: "React DevTools" },
  { name: "__VUE_DEVTOOLS_GLOBAL_HOOK__", category: "devtools", confidence: "low", description: "Vue DevTools" },
  { name: "__REDUX_DEVTOOLS_EXTENSION__", category: "devtools", confidence: "low", description: "Redux DevTools" },
  
  // Automation tools
  { name: "__selenium_unwrapped", category: "automation", confidence: "high", description: "Selenium WebDriver" },
  { name: "__webdriver_evaluate", category: "automation", confidence: "high", description: "WebDriver Automation" },
  { name: "__nightmare", category: "automation", confidence: "high", description: "Nightmare.js" },
  { name: "callPhantom", category: "automation", confidence: "high", description: "PhantomJS" },
  { name: "__puppeteer__", category: "automation", confidence: "high", description: "Puppeteer" },
];

interface DomSignature {
  selector: string;
  category: ExtensionCategory;
  confidence: ConfidenceLevel;
  description: string;
}

const DOM_SIGNATURES: DomSignature[] = [
  // Screen recorder overlays
  { selector: ".obs-control", category: "screen_recorder", confidence: "high", description: "OBS Browser Plugin" },
  { selector: "#screencapture-overlay", category: "screen_recorder", confidence: "high", description: "Screen Capture Extension" },
  { selector: "[data-screencastify]", category: "screen_recorder", confidence: "high", description: "Screencastify" },
  { selector: ".loom-container", category: "screen_recorder", confidence: "high", description: "Loom" },
  
  // Common browser extensions that inject DOM elements
  { selector: "[data-grammarly-shadow-root]", category: "unknown", confidence: "high", description: "Grammarly Extension" },
  { selector: "grammarly-desktop-integration", category: "unknown", confidence: "high", description: "Grammarly Extension" },
  { selector: "#lastpass-icon", category: "unknown", confidence: "high", description: "LastPass Extension" },
  { selector: "[data-lastpass-icon-root]", category: "unknown", confidence: "high", description: "LastPass Extension" },
  { selector: ".dashlane-icon", category: "unknown", confidence: "high", description: "Dashlane Extension" },
  { selector: "[data-1p-extension]", category: "unknown", confidence: "high", description: "1Password Extension" },
  { selector: "#bitwarden-wrapper", category: "unknown", confidence: "high", description: "Bitwarden Extension" },
  { selector: "[data-honey-container]", category: "unknown", confidence: "high", description: "Honey Extension" },
  { selector: "#honey-button", category: "unknown", confidence: "high", description: "Honey Extension" },
  { selector: "[data-rakuten]", category: "unknown", confidence: "high", description: "Rakuten Extension" },
  { selector: ".mcafee-icon", category: "unknown", confidence: "high", description: "McAfee Extension" },
  { selector: "[data-translate-extension]", category: "unknown", confidence: "high", description: "Translate Extension" },
  { selector: ".dark-reader", category: "unknown", confidence: "high", description: "Dark Reader Extension" },
  { selector: "[data-darkreader]", category: "unknown", confidence: "high", description: "Dark Reader Extension" },
  
  // Automation markers
  { selector: "[webdriver]", category: "automation", confidence: "high", description: "Browser Automation Detected" },
];

// ============================================================================
// Hook Implementation
// ============================================================================

export function usePrecheckExtensions(): UsePrecheckExtensionsReturn {
  const [isScanning, setIsScanning] = useState(false);
  const [scanResult, setScanResult] = useState<ExtensionScanResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const scanIdRef = useRef(0);

  // Detect global variables
  const detectGlobalVars = useCallback((): DetectedExtension[] => {
    const detected: DetectedExtension[] = [];
    
    if (typeof window === "undefined") return detected;
    
    for (const sig of GLOBAL_VAR_SIGNATURES) {
      try {
        // Check if the global variable exists
        if ((window as any)[sig.name] !== undefined) {
          detected.push({
            id: `global_${sig.name}`,
            category: sig.category,
            signature: `window.${sig.name}`,
            confidence: sig.confidence,
            description: sig.description,
          });
        }
      } catch (e) {
        // Some properties may throw on access
        continue;
      }
    }
    
    // Additional WebDriver detection
    try {
      if (navigator.webdriver === true) {
        detected.push({
          id: "navigator_webdriver",
          category: "automation",
          signature: "navigator.webdriver",
          confidence: "high",
          description: "Browser Automation Detected",
        });
      }
    } catch (e) {
      // Ignore
    }
    
    return detected;
  }, []);

  // Detect DOM signatures
  const detectDomSignatures = useCallback((): DetectedExtension[] => {
    const detected: DetectedExtension[] = [];
    
    if (typeof document === "undefined") return detected;
    
    for (const sig of DOM_SIGNATURES) {
      try {
        const element = document.querySelector(sig.selector);
        if (element) {
          detected.push({
            id: `dom_${sig.selector.replace(/[^a-zA-Z0-9]/g, "_")}`,
            category: sig.category,
            signature: sig.selector,
            confidence: sig.confidence,
            description: sig.description,
          });
        }
      } catch (e) {
        // Invalid selector or other error
        continue;
      }
    }
    
    return detected;
  }, []);

  // Detect remote desktop / screen sharing activity
  const detectRemoteDesktop = useCallback(async (): Promise<DetectedExtension[]> => {
    const detected: DetectedExtension[] = [];
    
    if (typeof window === "undefined" || typeof navigator === "undefined") return detected;
    
    try {
      // Method 1: Check for active screen capture tracks
      // This can detect if screen is being shared via WebRTC
      if (navigator.mediaDevices && typeof navigator.mediaDevices.enumerateDevices === "function") {
        // Check if getDisplayMedia has been used (screen sharing active)
        // We can't directly check this, but we can look for signs
      }
      
      // Method 2: Check for multiple monitors (potential for hidden monitor with remote viewer)
      // Note: isExtended is part of the Multi-Screen Window Placement API (not widely supported)
      if (typeof window.screen !== "undefined" && (window.screen as any).isExtended === true) {
        detected.push({
          id: "extended_display",
          category: "remote_desktop",
          signature: "screen.isExtended",
          confidence: "low",
          description: "Extended Display Detected (multiple monitors)",
        });
      }
      
      // Method 3: Check for known remote desktop browser extensions
      const remoteDesktopSelectors = [
        "[data-anydesk]",
        "[data-teamviewer]", 
        "#anydesk-overlay",
        "#teamviewer-overlay",
        ".chrome-remote-desktop",
        "[data-chrome-remote-desktop]",
        "#crd-overlay",
        ".parsec-overlay",
      ];
      
      for (const selector of remoteDesktopSelectors) {
        try {
          if (document.querySelector(selector)) {
            detected.push({
              id: `remote_dom_${selector.replace(/[^a-zA-Z0-9]/g, "_")}`,
              category: "remote_desktop",
              signature: selector,
              confidence: "high",
              description: "Remote Desktop Overlay Detected",
            });
            break; // One detection is enough
          }
        } catch (e) {
          continue;
        }
      }
      
      // Method 4: Check for WebRTC peer connections that might indicate screen sharing
      // Note: This is a heuristic - legitimate video calls also use WebRTC
      if (typeof (window as any).RTCPeerConnection !== "undefined") {
        // Check if there are any active peer connections
        // This is limited because we can't enumerate all connections
        const originalRTCPeerConnection = (window as any).__originalRTCPeerConnection__;
        if (originalRTCPeerConnection) {
          detected.push({
            id: "rtc_hooked",
            category: "remote_desktop",
            signature: "RTCPeerConnection hooked",
            confidence: "medium",
            description: "WebRTC Connection Monitoring Detected",
          });
        }
      }
      
      // Method 5: Check window dimensions vs screen dimensions
      // Remote desktop viewers sometimes have different dimensions
      const screenWidth = window.screen.width;
      const screenHeight = window.screen.height;
      const outerWidth = window.outerWidth;
      const outerHeight = window.outerHeight;
      
      // If browser window is larger than screen, something is off
      if (outerWidth > screenWidth + 50 || outerHeight > screenHeight + 50) {
        detected.push({
          id: "dimension_mismatch",
          category: "remote_desktop",
          signature: "Window > Screen dimensions",
          confidence: "medium",
          description: "Unusual Window Dimensions (possible remote viewing)",
        });
      }
      
    } catch (err) {
      console.error("[ExtensionDetection] Remote desktop detection error:", err);
    }
    
    return detected;
  }, []);

  // Detect extensions by scanning for injected DOM elements dynamically
  const detectInjectedElements = useCallback((): DetectedExtension[] => {
    if (typeof document === "undefined") return [];
    
    const detected: DetectedExtension[] = [];
    
    // Get all elements and check for extension-injected attributes/elements
    const allElements = document.querySelectorAll("*");
    const extensionPatterns: { pattern: RegExp; description: string }[] = [
      { pattern: /^grammarly/i, description: "Grammarly Extension" },
      { pattern: /^lastpass/i, description: "LastPass Extension" },
      { pattern: /^bitwarden/i, description: "Bitwarden Extension" },
      { pattern: /^1password/i, description: "1Password Extension" },
      { pattern: /^dashlane/i, description: "Dashlane Extension" },
      { pattern: /^honey/i, description: "Honey Extension" },
      { pattern: /^rakuten/i, description: "Rakuten Extension" },
      { pattern: /^dark-?reader/i, description: "Dark Reader Extension" },
      { pattern: /^ublock/i, description: "uBlock Extension" },
      { pattern: /^adblock/i, description: "AdBlock Extension" },
    ];
    
    const detectedIds = new Set<string>();
    
    allElements.forEach((el) => {
      const tagName = el.tagName.toLowerCase();
      const id = el.id?.toLowerCase() || "";
      const className = el.className?.toString?.()?.toLowerCase() || "";
      
      // Check for custom elements (extensions often inject custom tags)
      if (tagName.includes("-") && !tagName.startsWith("data-")) {
        for (const { pattern, description } of extensionPatterns) {
          if (pattern.test(tagName) && !detectedIds.has(description)) {
            detectedIds.add(description);
            detected.push({
              id: `injected_${tagName}`,
              category: "unknown",
              signature: tagName,
              confidence: "high",
              description,
            });
          }
        }
      }
      
      // Check IDs and classes
      for (const { pattern, description } of extensionPatterns) {
        if ((pattern.test(id) || pattern.test(className)) && !detectedIds.has(description)) {
          detectedIds.add(description);
          detected.push({
            id: `injected_${id || className}`,
            category: "unknown",
            signature: id || className,
            confidence: "high",
            description,
          });
        }
      }
      
      // Check for data attributes commonly used by extensions
      const attrs = el.attributes;
      for (let i = 0; i < attrs.length; i++) {
        const attrName = attrs[i].name.toLowerCase();
        for (const { pattern, description } of extensionPatterns) {
          if (pattern.test(attrName) && !detectedIds.has(description)) {
            detectedIds.add(description);
            detected.push({
              id: `attr_${attrName}`,
              category: "unknown",
              signature: attrName,
              confidence: "high",
              description,
            });
          }
        }
      }
    });
    
    return detected;
  }, []);

  // Main scan function
  const scan = useCallback(async (): Promise<ExtensionScanResult> => {
    setIsScanning(true);
    setError(null);
    
    const currentScanId = ++scanIdRef.current;
    const startTime = performance.now();
    
    try {
      // Run all detections - NO MORE FAKE AD BLOCKER DETECTION
      const [globalVars, domSignatures, injectedElements, remoteDesktop] = await Promise.all([
        Promise.resolve(detectGlobalVars()),
        Promise.resolve(detectDomSignatures()),
        Promise.resolve(detectInjectedElements()),
        detectRemoteDesktop(),
      ]);
      
      // Check if this scan is still current
      if (currentScanId !== scanIdRef.current) {
        throw new Error("Scan cancelled");
      }
      
      // Combine results and deduplicate
      const allExtensions = [...globalVars, ...domSignatures, ...injectedElements, ...remoteDesktop];
      
      // Deduplicate by description (more user-friendly)
      const seen = new Set<string>();
      const uniqueExtensions = allExtensions.filter((ext) => {
        if (seen.has(ext.description)) return false;
        seen.add(ext.description);
        return true;
      });
      
      const scanTime = performance.now() - startTime;
      
      // Harmful categories that should block the assessment
      const harmfulCategories: ExtensionCategory[] = ["screen_recorder", "automation", "remote_desktop"];
      
      const result: ExtensionScanResult = {
        extensions: uniqueExtensions,
        hasHighRisk: uniqueExtensions.some(
          (e) => e.confidence === "high" && harmfulCategories.includes(e.category)
        ),
        hasMediumRisk: uniqueExtensions.some(
          (e) => e.confidence === "medium" || e.confidence === "high"
        ),
        hasAnyExtension: uniqueExtensions.length > 0,
        // Only block if harmful extension is detected (screen recorder, automation, remote desktop)
        hasHarmfulExtension: uniqueExtensions.some(
          (e) => harmfulCategories.includes(e.category)
        ),
        scanTime,
      };
      
      setScanResult(result);
      return result;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Scan failed";
      if (errorMessage !== "Scan cancelled") {
        setError(errorMessage);
      }
      throw err;
    } finally {
      if (currentScanId === scanIdRef.current) {
        setIsScanning(false);
      }
    }
  }, [detectGlobalVars, detectDomSignatures, detectInjectedElements, detectRemoteDesktop]);

  // Report warning to backend
  const reportWarning = useCallback(async (assessmentId: string, userId: string): Promise<void> => {
    if (!scanResult || scanResult.extensions.length === 0) return;
    
    try {
      await fetch("/api/proctor/record", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventType: "PRECHECK_WARNING",
          timestamp: new Date().toISOString(),
          assessmentId,
          userId,
          metadata: {
            source: "extension_detection",
            extensions: scanResult.extensions.map((e) => ({
              category: e.category,
              signature: e.signature,
              confidence: e.confidence,
            })),
            hasHighRisk: scanResult.hasHighRisk,
            hasMediumRisk: scanResult.hasMediumRisk,
          },
        }),
      });
    } catch (err) {
      console.error("[ExtensionDetection] Failed to report warning:", err);
    }
  }, [scanResult]);

  return {
    isScanning,
    scanResult,
    error,
    scan,
    reportWarning,
  };
}

export default usePrecheckExtensions;

