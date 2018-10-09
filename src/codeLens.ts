import { CancellationToken, CodeLens, DecorationOptions, DecorationRangeBehavior, DecorationRenderOptions, Position, ProviderResult, Range, TextDocument, ThemeColor, window, workspace, ExtensionContext } from "vscode";
import { ProvideCodeLensesSignature } from "vscode-languageclient";
import * as ls from 'vscode-languageserver-types';
import { CclsClient } from "./client";


// TODO(riatre): Make a middleware chain instead of this bizarre mono class

// For inline code lens.
let decorationOpts: DecorationRenderOptions = {
  after: {
    fontStyle: 'italic',
    color: new ThemeColor('editorCodeLens.foreground'),
  },
  rangeBehavior: DecorationRangeBehavior.ClosedClosed,
};

let codeLensDecoration = window.createTextEditorDecorationType(
  decorationOpts);

function displayCodeLens(document: TextDocument, allCodeLens: CodeLens[]) {
  for (let editor of window.visibleTextEditors) {
    if (editor.document != document)
      continue;

    let opts: DecorationOptions[] = [];

    for (let codeLens of allCodeLens) {
      // FIXME: show a real warning or disable on-the-side code lens.
      if (!codeLens.isResolved)
        console.error('Code lens is not resolved');

      // Default to after the content.
      let position = codeLens.range.end;

      // If multiline push to the end of the first line - works better for
      // functions.
      if (codeLens.range.start.line != codeLens.range.end.line)
        position = new Position(codeLens.range.start.line, 1000000);

      let range = new Range(position, position);
      let opt: DecorationOptions = {
        range: range,
        renderOptions:
            {after: {contentText: ' ' + codeLens.command.title + ' '}}
      };

      opts.push(opt);
    }

    editor.setDecorations(codeLensDecoration, opts);
  }
}

let ccls: CclsClient;

export function provideCodeLenses(
  document: TextDocument, token: CancellationToken,
  next: ProvideCodeLensesSignature): ProviderResult<CodeLens[]> {
  let config = workspace.getConfiguration('ccls');
  let enableInlineCodeLens = config.get('codeLens.renderInline', false);
  if (!enableInlineCodeLens || !ccls)
    return next(document, token);

  // We run the codeLens request ourselves so we can intercept the response.
  return ccls.client
    .sendRequest('textDocument/codeLens', {
      textDocument: {
        uri: document.uri.toString(),
      },
    })
    .then((a: ls.CodeLens[]): CodeLens[] => {
      let result: CodeLens[] =
        ccls.client.protocol2CodeConverter.asCodeLenses(a);
      displayCodeLens(document, result);
      return [];
    });
};

export function activate(context: ExtensionContext, _ccls: CclsClient) {
  ccls = _ccls;
}
