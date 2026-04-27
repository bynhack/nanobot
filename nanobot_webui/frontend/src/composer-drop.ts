export function hasDraggedFiles(
  dataTransfer: Pick<DataTransfer, 'types'> | null | undefined,
): boolean {
  if (!dataTransfer) {
    return false;
  }
  return Array.from(dataTransfer.types ?? []).includes('Files');
}

export function fileListToArray(fileList: FileList | null | undefined): File[] {
  if (!fileList) {
    return [];
  }
  return Array.from(fileList);
}

export async function attachDroppedFiles(
  files: readonly File[],
  addAttachment: (file: File) => Promise<void> | void,
): Promise<void> {
  for (const file of files) {
    await addAttachment(file);
  }
}
