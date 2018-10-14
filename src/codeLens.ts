import { CancellationToken, CodeLens, DecorationOptions, DecorationRangeBehavior, DecorationRenderOptions, Position, ProviderResult, Range, TextDocument, ThemeColor, window, workspace, ExtensionContext, commands, Uri } from "vscode";
import { ProvideCodeLensesSignature } from "vscode-languageclient";
import * as ls from 'vscode-languageserver-types';
import { CclsClient } from "./client";

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

function overrideCclsXrefCommand(document: TextDocument, result: CodeLens[]) {
  return result.map((val) => {
    if (val.command && val.command.command === 'ccls.xref') {
      val.command.command = 'ccls._xref';
      val.command.arguments.push(document.uri);
      val.command.arguments.push(val.range);
    }
    return val;
  });
}

function xrefCommandHandler(...args) {
  let range: Range = args.pop();
  let uri: Uri = args.pop();
  commands.executeCommand('ccls.xref', ...args)
    .then(
      (locations: ls.Location[]) => commands.executeCommand(
        'editor.action.showReferences', uri, range.start,
        locations.map(ccls.client.protocol2CodeConverter.asLocation)));
}

let ccls: CclsClient;

export function provideCodeLenses(
  document: TextDocument, token: CancellationToken,
  next: ProvideCodeLensesSignature): ProviderResult<CodeLens[]> {
  let config = workspace.getConfiguration('ccls');
  let enableCodeLens = config.get('codeLens.enabled', true);
  if (!enableCodeLens) return [];
  let enableInlineCodeLens = config.get('codeLens.renderInline', false);
  if (!enableInlineCodeLens || !ccls) {
    let result = next(document, token);
    if (result instanceof Array) {
      return overrideCclsXrefCommand(document, result);
    } else {
      return result.then(val => overrideCclsXrefCommand(document, val));
    }
  }

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
  commands.registerCommand('ccls._xref', xrefCommandHandler);
}
