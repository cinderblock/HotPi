function shouldPrint(name: any): string {
  if (typeof name === 'string') return name;
  if (name === undefined) return '';
  if (name === null) return '';
  if (name === false) return '';
  if (name === true) return 'true';
  if (typeof name === 'number') return String(name);
  if (typeof name === 'bigint') return String(name);
  if (typeof name === 'symbol') return String(name);
  if (typeof name === 'function') return 'function';
  if (typeof name === 'object') return JSON.stringify(name);
  if (typeof name === 'undefined') return '';
  if (Array.isArray(name)) return name.map(shouldPrint).join(', ');
  if (name instanceof Error) return name.message;
  if (name instanceof Date) return name.toISOString();
  if (name instanceof Promise) return 'Promise';

  return String(name);
}

/**
 * Trim at most one space from end of a string
 * @param str
 */
function trimOneSpace(str: string): string {
  if (str.length === 0) return str;
  if (str[str.length - 1] === ' ') return str.slice(0, -1);
  return str;
}

/**
 * Useful for string interpolation. This is a template literal function.
 * Example:
 * ```ts
 * const name = 'John';
 * const age = 30;
 * const str = str`Hello ${name}! You are ${age} years old.`;
 * console.log(str); // Hello John! You are 30 years old.
 * ```
 * However if the value is undefined, null, or false you get an empty string.
 */
export function str(strings: TemplateStringsArray, ...values: unknown[]): string {
  return strings.reduce((acc, string, index) => trimOneSpace(acc + string + shouldPrint(values[index])), '');
}
