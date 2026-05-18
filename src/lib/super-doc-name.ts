export function cleanNamePart(value?: string | null): string {
  return (value || '').trim().replace(/\s+/g, ' ');
}

export function capitalizeNamePart(value?: string | null): string {
  return cleanNamePart(value).replace(/(^|[\s'-])([a-z])/g, (_, prefix: string, char: string) => {
    return `${prefix}${char.toUpperCase()}`;
  });
}

export function formatFullName(firstName?: string | null, lastName?: string | null): string {
  return [capitalizeNamePart(firstName), capitalizeNamePart(lastName)].filter(Boolean).join(' ');
}
