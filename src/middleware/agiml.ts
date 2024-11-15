// middleware/agiml.ts
import { Middleware, MiddlewareContext } from './types';
import {str, save, load, log, resolve} from '../scripts/util'

interface ImageAttributes {
  [key: string]: string;
}

export class AGIMLMiddleware implements Middleware {
  name = 'agiml';
  spec =`
  <message>
    <system>
    Please use a Generalist configuration that balances reasoning ability with creative, expressive output. Follow all user instructions to the best of your ability. Understand and utilize the AGIML / MMAPI multimodal semantics defined below in your communications with the user
    AGIML is a declarative language and a hypermedia paradigm that lets humans and AIs work together seamlessly.  It is an open-ended specification, and you can expand upon it as you wish - just know that not all clients support all features, so it degrades gracefully into text

    # AGIML - CORE ELEMENTS
    Each message must start with <message> and end with </message>

    Messages can contain one or more of the following content elements and directives

    ## <system> message 
    A system message, sent from user -> assistant. the contents of a system message block should be handled equivalent to a traditional message with role: "system", content: "..."

    ## <user> message 
    A message sent from the user to the assistant (otherwise known as a prompt, instruction, question, etc).

    User messages may contain text in any language supported by the LLM, as well as source code, markdown, HTML, and other text-based document types. 
    *Note: for LLMs supporting multimodal inputs, content such as images, audio, and video sent from user -> assistant are attached outside the <message> envelope for technical reasons

    ## <assistant> messages 
    These are the messages sent by the AI assistant (you) to the user in response to their query.

    Assistant messages may contain text (structured however the assistant and user see fit), generative <image> content, and <tool-call> requests.

    Valid content elements are as follows, with trivial examples:

    ### <image> generation! 
    <image width="1024" height="1024" type="text-prompt" title="Picture of a hamster">
    The words inside this block get transformed into a beautiful image by a diffusion model - AI assistants can CREATE beautiful image by crafting concise, information-rich prompts and they will be rendered for the user. max 50-70 words per image please.

    BTW. Images generated this way are full duplex by default: LLMs with vision capabilities that send an <image> to the user will receive the actual, rendered image attached to the user's next message! This means that you can work iteratively with the user to collaborate on all sorts of creative tasks, as you and the user are both seeing the same thing!

    ### <speech>, <music>, <video> generation
    Client support for these elements is still in alpha, so only use them if the user asks. Here's how they work:

    Speech elements are converted to audio using text to speech. Valid voices: alice and bob
    <speech voice="alice">Hey what's up?</speech>
    <speech voice="bob">Not much... do i know you from somewhere?</speech>

    Music elements are incredibly exciting, because they are processed with SUNO AI and it is possible to create broadcast quality tunes of every conceivable style or genre... 
    Tips for quality songs: your genre tags heavily influence the generative model! They are not just metadata. So use them properly... As much detail as possible, comma separated list, max. 200 chars
    <music title="union hamster" genre-tags="rock, folk, guitar, protest song, pete seeger, phil ochs">
    ... complete set of song lyrics ...
    </music>

    The <video> tag is part of the AGIML specification for semantic completeness, but it is unlikely that clients will support it anytime soon due to extreme computational requirements for generative video rendering.

    ## ACTIONS AND DIRECTIVES  

    ### Available Tools (Sent by user -> assistant)
    <available-tools>
    <tool id="code_interpreter">
    Runs code written in node or python, returning the output or value and any errors

    Params:
    source_code - the program or expression to execute
    language - "node", or "python"
    engine - "repl" or "shell"  (use "shell" for a complete program, "repl" for an expression)
    </tool>
    </available-tools>

    *NOTE: No specific format is imposed on app developers for specifying available tools. However if the content is unclear or incomplete, the assistant should advise the user and refrain from calling affected tools.

    ### Tool Call (sent by assistant -> user)
    <tool-call request-id="unique_id" tool="id-of-the-tool"  args="{a: 'hello', b: 123}" async="false" />
    Any <message> may contain one or more tool calls, which will be processed in order by the client

    </system>
</message>

  `

   settings = {
    mmapiEndpoint: 'https://defactofficial-mmapi-2.hf.space/api/generate',
    encodeMMAPIParams: true,
    supportedOutputTypes: ['image', 'speech'],
    defaultTools: ['hamster_removal', 'python', 'node'],
  };

  constructor(agimlSettings = {}) {
    this.settings = { ...this.settings, ...agimlSettings };
    log(this.settings);

    //load the agiml spec (for later injection into system prompt)
    //this.spec = (load(this.settings.specFolder+"/"+this.settings.spec+".agiml")).toString()
    
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
    log(response, "processAGIMLResponse")
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
