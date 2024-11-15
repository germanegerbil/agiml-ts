// middleware/agiml.ts
import { Middleware, MiddlewareContext } from './types';
import {str, save, load, log, resolve} from '../scripts/util'

interface ImageAttributes {
  [key: string]: string;
}

export class AGIMLMiddleware implements Middleware {
  name = 'agiml';
  spec =
    '<message><system>replace me with one of the instructional prompts in examples</system></message>';

   settings = {
    specFolder: '~/project/examples',
    spec: 'minimal',
    mmapiEndpoint: 'https://defactofficial-mmapi-2.hf.space/api/generate',
    encodeMMAPIParams: true,
    supportedOutputTypes: ['image', 'speech'],
    defaultTools: ['hamster_removal', 'python', 'node'],
  };

  constructor(agimlSettings = {}) {
    this.settings = { ...this.settings, ...agimlSettings };
    log(this.settings);

    //load the agiml spec (for later injection into system prompt)
    this.spec = (load(this.settings.specFolder+"/"+this.settings.spec+".agiml")).toString()
    
  }
  async beforeRequest(context: MiddlewareContext): Promise<MiddlewareContext> {
    // Wrap user message in AGIML envelope
    const wrappedMessage = `<message><user>${context.userMessage}</user></message>`;

    // Find and update system message, or create new one
    const systemMessageIndex = context.messages.findIndex(
      (m) => m.role === 'system'
    );
    if (systemMessageIndex >= 0) {
      context.messages[
        systemMessageIndex
      ].content = `${context.messages[systemMessageIndex].content}\n\n${this.spec}`;
    } else {
      context.messages.unshift({
        role: 'system',
        content: this.spec,
      });
    }

    return {
      ...context,
      userMessage: wrappedMessage,
      metadata: { ...context.metadata, format: 'agiml' },
    };
  }

  async afterResponse(context: MiddlewareContext): Promise<MiddlewareContext> {
    if (!context.response) return context;

    const transformedResponse = this.processAGIMLResponse(context.response);

    return {
      ...context,
      response: transformedResponse,
    };
  }

  private processAGIMLResponse(response: string): string {
    // Remove AGIML envelope if present
    response = response.replace(
      /<message>\s*<assistant>(.*?)<\/assistant>\s*<\/message>/s,
      '$1'
    );

    // Process image tags
    return response.replace(
      /<image(.*?)>(.*?)<\/image>/g,
      (match, attributes, content) => {
        const parsedAttrs = this.parseAttributes(attributes);
        const processedPrompt = this.processPrompt(content);
        return this.generateMarkdownImage(processedPrompt, parsedAttrs);
      }
    );
  }

  private parseAttributes(attributeString: string): ImageAttributes {
    const attrs: ImageAttributes = {};
    const matches = attributeString.match(/(\w+)="([^"]*?)"/g) || [];

    matches.forEach((match) => {
      const [key, value] = match.split('=').map((s) => s.replace(/"/g, ''));
      attrs[key.trim()] = value;
    });

    return attrs;
  }

  private processPrompt(prompt: string): string {
    return (
      prompt
        .trim()
        // Replace newlines with spaces
        .replace(/\n/g, ' ')
        // Remove all characters except alphanumeric and specified special chars
        .replace(/[^a-zA-Z0-9.,!()[\] ]/g, '')
        // Normalize spaces
        .replace(/\s+/g, ' ')
        // Encode for URL
        .split(' ')
        .map(encodeURIComponent)
        .join('%20')
    );
  }

  private generateMarkdownImage(
    prompt: string,
    attrs: ImageAttributes
  ): string {
    // Start building the URL with the base and prompt
    let url = `${this.settings.mmapiEndpoint}/image?prompt=${prompt}`;

    // Add any additional attributes as query parameters
    for (const [key, value] of Object.entries(attrs)) {
      if (key !== 'type') {
        // Skip the type attribute as it's not needed in the URL
        url += `&${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
      }
    }

    // Return markdown image with prompt as alt text and caption
    return `![${decodeURIComponent(prompt)}](${url})\n*${decodeURIComponent(
      prompt
    )}*`;
  }
}
