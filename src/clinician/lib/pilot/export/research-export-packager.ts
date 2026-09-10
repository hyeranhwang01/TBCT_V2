import JSZip from "jszip";

export async function buildResearchExportZip(files: Record<string, string>) {
  const zip = new JSZip();
  Object.entries(files).forEach(([filename, content]) => {
    zip.file(filename, content);
  });
  return zip.generateAsync({ type: "blob" });
}
