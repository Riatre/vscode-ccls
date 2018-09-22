import { commands, ExtensionContext, workspace } from "vscode";
import * as ls from 'vscode-languageserver-types';
import { CclsClient } from "./client";
import { jumpToUriAtPosition } from "./utils";

interface LspLocatableNode {
  id: any;
  location: ls.Location;
}

export function activate(context: ExtensionContext, ccls: CclsClient) {
  // Common between tree views.
  commands.registerCommand(
    'ccls.gotoForTreeView',
    (node: LspLocatableNode) => {
      if (!node.location)
        return;

      let loc = ccls.client.protocol2CodeConverter.asLocation(node.location);
      jumpToUriAtPosition(loc.uri, loc.range.start, true /*preserveFocus*/)
    });

  let lastGotoNodeId: any
  let lastGotoClickTime: number
  commands.registerCommand(
      'ccls.hackGotoForTreeView',
      (node: LspLocatableNode, hasChildren: boolean) => {
        if (!node.location)
          return;

        if (!hasChildren) {
          commands.executeCommand('ccls.gotoForTreeView', node);
          return;
        }

        if (lastGotoNodeId != node.id) {
          lastGotoNodeId = node.id;
          lastGotoClickTime = Date.now();
          return;
        }

        let config = workspace.getConfiguration('ccls');
        const kDoubleClickTimeMs =
            config.get('treeViews.doubleClickTimeoutMs');
        const elapsed = Date.now() - lastGotoClickTime;
        lastGotoClickTime = Date.now();
        if (elapsed < kDoubleClickTimeMs)
          commands.executeCommand('ccls.gotoForTreeView', node);
      });
}
