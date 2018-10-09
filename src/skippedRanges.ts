import { DecorationRangeBehavior, ExtensionContext, Range, window, workspace } from "vscode";
import { CclsClient } from "./client";
import { normalizeUri } from "./utils";

export function activate(context: ExtensionContext, ccls: CclsClient) {
  let config = workspace.getConfiguration('ccls');
  if (!config.get('misc.showInactiveRegions')) return;

  const decorationType = window.createTextEditorDecorationType({
    isWholeLine: true,
    light: {
      color: config.get('theme.light.skippedRange.textColor'),
      backgroundColor:
        config.get('theme.light.skippedRange.backgroundColor'),
    },
    dark: {
      color: config.get('theme.dark.skippedRange.textColor'),
      backgroundColor:
        config.get('theme.dark.skippedRange.backgroundColor'),
    },
    rangeBehavior: DecorationRangeBehavior.ClosedClosed
  });

  let skippedRanges = new Map<string, Range[]>();

  ccls.client.onReady().then(() => {
    ccls.client.onNotification('$ccls/setSkippedRanges', (args) => {
      let uri = normalizeUri(args.uri);
      let ranges: Range[] =
          args.skippedRanges.map(ccls.client.protocol2CodeConverter.asRange);
      ranges = ranges.map((range) => {
        if (range.isEmpty || range.isSingleLine) return range;
        return range.with({ end: range.end.translate(-1, 23333) });
      });
      skippedRanges.set(uri, ranges);
      window.visibleTextEditors
        .filter(editor => editor.document.uri.toString() == uri)
        .forEach(editor => editor.setDecorations(decorationType, ranges));
    });
  });

  window.onDidChangeActiveTextEditor(editor => {
    const uri = editor.document.uri.toString();
    if (skippedRanges.has(uri)) {
      editor.setDecorations(decorationType, skippedRanges.get(uri));
    }
  }, null, context.subscriptions);

  // This only got called during dispose, which perfectly matches our goal.
  workspace.onDidCloseTextDocument(document => {
    skippedRanges.delete(document.uri.toString());
  }, null, context.subscriptions);
}