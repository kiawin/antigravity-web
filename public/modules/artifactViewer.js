/**
 * Artifact Viewer
 */

export function showArtifactViewer(html, className) {
  // Remove existing viewer
  const existing = document.getElementById("artifactViewer");
  if (existing) existing.remove();

  // Create viewer overlay
  const viewer = document.createElement("div");
  viewer.id = "artifactViewer";
  viewer.className = "artifact-viewer-overlay";

  viewer.innerHTML = `<div class="artifact-viewer-content" id="artifactContent"></div>`;

  const innerContainer = document.createElement("div");
  innerContainer.className = className;
  innerContainer.style.height = "100%";
  innerContainer.innerHTML = html;

  // Find header and inject controls
  let header = innerContainer.querySelector(
    '[class*="flex"][class*="items-center"]',
  );
  if (!header && innerContainer.firstElementChild?.tagName === "DIV") {
    header = innerContainer.firstElementChild;
  }

  if (header) {
    const leftGroup = document.createElement("div");
    leftGroup.style.cssText = "display:flex;align-items:center;gap:0";

    const nav = document.createElement("div");
    nav.className = "artifact-viewer-nav-injected";
    nav.innerHTML = `
            <button class="artifact-viewer-btn" id="backArtifactViewer">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 18l-6-6 6-6"/></svg>
            </button>
            <button class="artifact-viewer-btn" disabled>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>
            </button>
        `;

    leftGroup.appendChild(nav);
    if (header.firstChild) leftGroup.appendChild(header.firstChild);
    header.prepend(leftGroup);

    const closeDiv = document.createElement("div");
    closeDiv.innerHTML = `
            <button class="artifact-viewer-btn" id="closeArtifactViewer">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </button>
        `;
    header.appendChild(closeDiv);
  } else {
    // Floating buttons fallback
    const fab = document.createElement("button");
    fab.className = "artifact-viewer-fab-close";
    fab.id = "closeArtifactViewer";
    fab.innerHTML = `<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>`;
    viewer.appendChild(fab);

    const backFab = document.createElement("button");
    backFab.className = "artifact-viewer-fab-back";
    backFab.id = "backArtifactViewer";
    backFab.innerHTML = `<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M15 18l-6-6 6-6"/></svg>`;
    viewer.appendChild(backFab);
  }

  document.body.appendChild(viewer);

  const contentArea = viewer.querySelector("#artifactContent");
  contentArea.appendChild(innerContainer);

  // Hide Review/Proceed buttons
  innerContainer.querySelectorAll("button").forEach((btn) => {
    const text = btn.textContent.trim();
    if (text === "Review" || text === "Proceed" || text === "Review Changes") {
      btn.style.display = "none";
    }
  });

  // Event handlers
  document
    .getElementById("backArtifactViewer")
    ?.addEventListener("click", () => viewer.remove());
  document
    .getElementById("closeArtifactViewer")
    ?.addEventListener("click", () => viewer.remove());
  viewer.addEventListener("click", (e) => {
    if (e.target === viewer) viewer.remove();
  });
}
