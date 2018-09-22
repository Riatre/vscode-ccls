import { commands, ExtensionContext, QuickPickItem, TextEditor, Uri, window, workspace } from 'vscode';
import { CclsClient } from './client';
import { jumpToUriAtPosition } from './utils';

function normalizeUri(u: string): string {
  return Uri.parse(u).toString();
}

let ccls: CclsClient;

// TODO(riatre): Add type annotation.
function applyFixIt(uri, pTextEdits) {
  const textEdits = ccls.client.protocol2CodeConverter.asTextEdits(pTextEdits);

  function applyEdits(e: TextEditor) {
    e.edit(editBuilder => {
       for (const edit of textEdits)
         editBuilder.replace(edit.range, edit.newText);
     }).then(success => {
      if (!success) window.showErrorMessage('Failed to apply FixIt');
    });
  }

  // Find existing open document.
  for (const textEditor of window.visibleTextEditors) {
    if (textEditor.document.uri.toString() == normalizeUri(uri)) {
      applyEdits(textEditor);
      return;
    }
  }

  // Failed, open new document.
  workspace.openTextDocument(Uri.parse(uri))
      .then(d => {window.showTextDocument(d).then(e => {
              if (!e)
                window.showErrorMessage('Failed to to get editor for FixIt');

              applyEdits(e);
            })});
}

function insertInclude(uri, pTextEdits) {
  if (pTextEdits.length == 1)
    commands.executeCommand('ccls._applyFixIt', uri, pTextEdits);
  else {
    let items: Array<QuickPickItem> = [];
    class MyQuickPick implements QuickPickItem {
      constructor(
          public label: string, public description: string, public edit: any) {}
    }
    for (let edit of pTextEdits) {
      items.push(new MyQuickPick(edit.newText, '', edit));
    }
    window.showQuickPick(items).then((selected: MyQuickPick) => {
      commands.executeCommand('ccls._applyFixIt', uri, [selected.edit]);
    });
  }
}

export function activate(context: ExtensionContext, _ccls: CclsClient) {
  ccls = _ccls;

  commands.registerCommand('ccls._applyFixIt', applyFixIt);
  commands.registerCommand('ccls._insertInclude', insertInclude);
  commands.registerCommand('ccls._autoImplement', (uri, pTextEdits) => {
    commands.executeCommand('ccls._applyFixIt', uri, pTextEdits).then(() => {
      let converter = ccls.client.protocol2CodeConverter;
      jumpToUriAtPosition(
          converter.asUri(uri), converter.asLocation(pTextEdits[0]).range.start,
          /* preserveFocus */ false);
    });
  });
}
