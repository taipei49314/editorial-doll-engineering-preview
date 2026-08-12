export const STRICT_JSON_ERROR_CODES = [
  "JSON_INVALID",
  "JSON_DUPLICATE_KEY",
  "JSON_LIMIT_EXCEEDED",
] as const;

export type StrictJsonErrorCode = (typeof STRICT_JSON_ERROR_CODES)[number];

export class StrictJsonError extends Error {
  public override readonly name = "StrictJsonError";

  public constructor(
    public readonly code: StrictJsonErrorCode,
    public readonly offset: number,
    message: string,
  ) {
    super(message);
  }
}

const isWhitespace = (character: string | undefined): boolean =>
  character === " " ||
  character === "\n" ||
  character === "\r" ||
  character === "\t";

const isHexadecimal = (character: string | undefined): boolean =>
  character !== undefined && /^[0-9a-fA-F]$/u.test(character);

const isDigit = (character: string | undefined): boolean =>
  character !== undefined && character >= "0" && character <= "9";

const MAX_JSON_DEPTH = 64;
const MAX_JSON_MEMBERS = 10_000;

class DuplicateKeyScanner {
  private offset = 0;
  private depth = 0;
  private members = 0;

  public constructor(private readonly input: string) {}

  public scan(): void {
    this.skipWhitespace();
    this.readValue();
    this.skipWhitespace();
    if (this.offset !== this.input.length) {
      this.invalid("Unexpected content after the JSON value.");
    }
  }

  private readValue(): void {
    const character = this.input[this.offset];
    if (character === "{") {
      this.readObject();
      return;
    }
    if (character === "[") {
      this.readArray();
      return;
    }
    if (character === '"') {
      this.readString();
      return;
    }
    if (character === "t") {
      this.readLiteral("true");
      return;
    }
    if (character === "f") {
      this.readLiteral("false");
      return;
    }
    if (character === "n") {
      this.readLiteral("null");
      return;
    }
    if (character === "-" || (character !== undefined && /[0-9]/u.test(character))) {
      this.readNumber();
      return;
    }

    this.invalid("Expected a JSON value.");
  }

  private readObject(): void {
    this.enterContainer();
    this.offset += 1;
    this.skipWhitespace();
    const keys = new Set<string>();
    if (this.consume("}")) {
      this.leaveContainer();
      return;
    }

    while (true) {
      this.countMember();
      if (this.input[this.offset] !== '"') {
        this.invalid("Expected an object key.");
      }
      const keyStart = this.offset;
      const key = this.readString();
      if (keys.has(key)) {
        throw new StrictJsonError(
          "JSON_DUPLICATE_KEY",
          keyStart,
          `Duplicate JSON object key: ${key}.`,
        );
      }
      keys.add(key);

      this.skipWhitespace();
      this.expect(":", "Expected ':' after an object key.");
      this.skipWhitespace();
      this.readValue();
      this.skipWhitespace();
      if (this.consume("}")) {
        this.leaveContainer();
        return;
      }
      this.expect(",", "Expected ',' or '}' after an object member.");
      this.skipWhitespace();
    }
  }

  private readArray(): void {
    this.enterContainer();
    this.offset += 1;
    this.skipWhitespace();
    if (this.consume("]")) {
      this.leaveContainer();
      return;
    }

    while (true) {
      this.countMember();
      this.readValue();
      this.skipWhitespace();
      if (this.consume("]")) {
        this.leaveContainer();
        return;
      }
      this.expect(",", "Expected ',' or ']' after an array value.");
      this.skipWhitespace();
    }
  }

  private readString(): string {
    const start = this.offset;
    this.expect('"', "Expected a JSON string.");
    while (this.offset < this.input.length) {
      const character = this.input[this.offset];
      if (character === '"') {
        this.offset += 1;
        const raw = this.input.slice(start, this.offset);
        try {
          return JSON.parse(raw) as string;
        } catch {
          this.invalidAt(start, "Invalid JSON string.");
        }
      }
      if (character === "\\") {
        this.offset += 1;
        const escape = this.input[this.offset];
        if (escape === "u") {
          for (let index = 1; index <= 4; index += 1) {
            if (!isHexadecimal(this.input[this.offset + index])) {
              this.invalid("Invalid Unicode escape in JSON string.");
            }
          }
          this.offset += 5;
          continue;
        }
        if (
          escape !== '"' &&
          escape !== "\\" &&
          escape !== "/" &&
          escape !== "b" &&
          escape !== "f" &&
          escape !== "n" &&
          escape !== "r" &&
          escape !== "t"
        ) {
          this.invalid("Invalid escape in JSON string.");
        }
        this.offset += 1;
        continue;
      }
      if (character === undefined || character.charCodeAt(0) <= 0x1f) {
        this.invalid("Unescaped control character in JSON string.");
      }
      this.offset += 1;
    }

    this.invalidAt(start, "Unterminated JSON string.");
  }

  private readLiteral(literal: string): void {
    if (this.input.slice(this.offset, this.offset + literal.length) !== literal) {
      this.invalid(`Expected '${literal}'.`);
    }
    this.offset += literal.length;
  }

  private readNumber(): void {
    if (this.input[this.offset] === "-") {
      this.offset += 1;
    }

    if (this.input[this.offset] === "0") {
      this.offset += 1;
    } else {
      const firstDigit = this.input[this.offset];
      if (firstDigit === undefined || firstDigit < "1" || firstDigit > "9") {
        this.invalid("Invalid JSON number.");
      }
      while (isDigit(this.input[this.offset])) {
        this.offset += 1;
      }
    }

    if (this.input[this.offset] === ".") {
      this.offset += 1;
      if (!isDigit(this.input[this.offset])) {
        this.invalid("Invalid JSON number fraction.");
      }
      while (isDigit(this.input[this.offset])) {
        this.offset += 1;
      }
    }

    const exponent = this.input[this.offset];
    if (exponent === "e" || exponent === "E") {
      this.offset += 1;
      const sign = this.input[this.offset];
      if (sign === "+" || sign === "-") {
        this.offset += 1;
      }
      if (!isDigit(this.input[this.offset])) {
        this.invalid("Invalid JSON number exponent.");
      }
      while (isDigit(this.input[this.offset])) {
        this.offset += 1;
      }
    }
  }

  private enterContainer(): void {
    if (this.depth >= MAX_JSON_DEPTH) {
      throw new StrictJsonError(
        "JSON_LIMIT_EXCEEDED",
        this.offset,
        "JSON nesting exceeds the supported limit.",
      );
    }
    this.depth += 1;
  }

  private leaveContainer(): void {
    this.depth -= 1;
  }

  private countMember(): void {
    this.members += 1;
    if (this.members > MAX_JSON_MEMBERS) {
      throw new StrictJsonError(
        "JSON_LIMIT_EXCEEDED",
        this.offset,
        "JSON members exceed the supported limit.",
      );
    }
  }

  private skipWhitespace(): void {
    while (isWhitespace(this.input[this.offset])) {
      this.offset += 1;
    }
  }

  private consume(character: string): boolean {
    if (this.input[this.offset] !== character) {
      return false;
    }
    this.offset += 1;
    return true;
  }

  private expect(character: string, message: string): void {
    if (!this.consume(character)) {
      this.invalid(message);
    }
  }

  private invalid(message: string): never {
    return this.invalidAt(this.offset, message);
  }

  private invalidAt(offset: number, message: string): never {
    throw new StrictJsonError("JSON_INVALID", offset, message);
  }
}

/**
 * Parses JSON only after a structural scan has rejected duplicate object keys.
 * Native JSON.parse otherwise silently keeps the last occurrence of a key.
 */
export const parseStrictJson = (input: string): unknown => {
  try {
    new DuplicateKeyScanner(input).scan();
  } catch (error: unknown) {
    if (error instanceof StrictJsonError) {
      throw error;
    }
    throw new StrictJsonError("JSON_INVALID", 0, "Invalid JSON input.");
  }

  try {
    return JSON.parse(input) as unknown;
  } catch {
    throw new StrictJsonError("JSON_INVALID", 0, "Invalid JSON input.");
  }
};
