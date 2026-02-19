import { generateText, type LanguageModel } from "ai";
import { getLogger } from "../logging/index.js";

const DEFAULT_PROMPT =
  "Generate a concise 4-5 word title for this conversation based on the user's message. " +
  "Return only the title text, nothing else. No quotes, no punctuation at the end.";

const MAX_TITLE_LENGTH = 60;

type SessionTitleGeneratorInput = {
  model: LanguageModel;
  prompt?: string;
};

export class SessionTitleGenerator {
  private readonly model: LanguageModel;
  private readonly prompt: string;

  constructor({ model, prompt }: SessionTitleGeneratorInput) {
    this.model = model;
    this.prompt = prompt ?? DEFAULT_PROMPT;
  }

  async generate({ userMessage }: { userMessage: string }): Promise<string> {
    const log = getLogger().child({ component: "title-generator" });

    const result = await generateText({
      model: this.model,
      messages: [
        { role: "system", content: this.prompt },
        { role: "user", content: userMessage },
      ],
    });

    let title = result.text.trim();
    if (title.length > MAX_TITLE_LENGTH) {
      title = title.slice(0, MAX_TITLE_LENGTH).trimEnd();
    }

    log.debug({ title, userMessageLength: userMessage.length }, "Generated session title");
    return title;
  }
}
