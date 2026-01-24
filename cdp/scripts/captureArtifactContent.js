/**
 * Capture Artifact Content (Implementation Plan, Files, etc.)
 * This script runs in the browser context via CDP
 */

// Script to click the Open button for an artifact
export const clickArtifactOpenScript = async function (params) {
  const { buttonText, artifactTitle } = params;

  try {
    // Find all artifact containers
    const containers = Array.from(document.querySelectorAll(".rounded-md"));

    for (const container of containers) {
      const titleSpan = container.querySelector(".break-all");
      const title = titleSpan ? titleSpan.textContent.trim() : "";

      if (artifactTitle && title !== artifactTitle) {
        continue;
      }

      const openBtn = Array.from(container.querySelectorAll("button")).find(
        (btn) => btn.textContent.trim() === buttonText,
      );

      if (openBtn) {
        openBtn.click();
        return { clicked: true, title };
      }
    }

    return { error: `No matching Open button found for: ${artifactTitle}` };
  } catch (e) {
    return { error: e.toString() };
  }
};

// Script to capture the artifact content after clicking Open
export const captureArtifactScript = async function (params) {
  const { isFile, artifactTitle } = params;

  try {
    const debug = { strategy: "" };

    if (isFile) {
      const editors = Array.from(document.querySelectorAll(".editor-instance"));
      const targetEditor = editors.find((el) => {
        const label = el.getAttribute("aria-label") || "";
        const uri = el.getAttribute("data-uri") || "";
        return label === artifactTitle || uri.endsWith(`/${artifactTitle}`);
      });

      if (targetEditor) {
        debug.strategy = "file-editor-uri";
        const uri = targetEditor.getAttribute("data-uri");
        return {
          success: true,
          isFile: true,
          uri,
          debug,
        };
      }
    }

    // Look for artifact-view containers
    const artifactContainers = Array.from(
      document.querySelectorAll('[class*="artifact-view"]'),
    ).filter((el) => el.offsetParent !== null);

    debug.artifactViewsFound = artifactContainers.length;

    if (artifactContainers.length > 0) {
      const artifactContainer = artifactContainers[0];
      debug.strategy = "direct-artifact-view";

      const classMatch = artifactContainer.className.match(
        /editor-pane-parent-class-([\w-]+)/,
      );
      const artifactId = classMatch ? classMatch[1] : null;

      const clone = artifactContainer.cloneNode(true);

      return {
        success: true,
        artifactId,
        html: clone.innerHTML,
        className: artifactContainer.className,
        dimensions: {
          width: artifactContainer.offsetWidth,
          height: artifactContainer.offsetHeight,
        },
        debug,
      };
    }

    return { error: "No artifact view found after click", debug };
  } catch (e) {
    return { error: e.toString() };
  }
};
