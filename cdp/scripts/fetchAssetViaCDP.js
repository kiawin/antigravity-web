/**
 * Fetch Asset via CDP (for proxying vscode-file://)
 * This script runs in the browser context via CDP
 */

export const fetchAssetScript = async function (params) {
  const { url } = params;

  try {
    const response = await fetch(url);
    if (!response.ok) return { error: `Fetch failed: ${response.status}` };
    const blob = await response.blob();

    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () =>
        resolve({
          success: true,
          data: reader.result.split(",")[1], // Base64 data without prefix
          type:
            response.headers.get("content-type") ||
            blob.type ||
            "application/octet-stream",
        });
      reader.onerror = () => resolve({ error: "Reader failed" });
      reader.readAsDataURL(blob);
    });
  } catch (e) {
    return { error: e.toString() };
  }
};
