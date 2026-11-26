// Saves bytes that are already in memory as a file, without a round trip to any server.
export function downloadFile(data: ArrayBuffer, name: string, type = 'model/stl') {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
