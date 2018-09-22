import * as path from 'path';
import { commands, Event, EventEmitter, ExtensionContext, TreeDataProvider, TreeItem, TreeItemCollapsibleState, Uri, window } from 'vscode';
import { LanguageClient } from 'vscode-languageclient/lib/main';
import * as ls from 'vscode-languageserver-types';
import { CclsClient } from './client';
import { setContext } from './utils';

enum CallType {
  Normal = 0,
  Base = 1,
  Derived = 2,
  All = 3 // Normal & Base & Derived
}
class CallHierarchyNode {
  // These properties come directly from the language server.
  id: any
  name: string
  location: ls.Location
  callType: CallType

  // If |numChildren| != |children.length|, then the node has not been expanded
  // and is incomplete - we need to send a new request to expand it.
  numChildren: number
  children: CallHierarchyNode[]
}

class CallHierarchyProvider implements TreeDataProvider<CallHierarchyNode> {
  root: CallHierarchyNode;

  constructor(
    readonly languageClient: LanguageClient, readonly derivedDark: string,
    readonly derivedLight: string, readonly baseDark: string,
    readonly baseLight: string) { }

  readonly onDidChangeEmitter: EventEmitter<any> = new EventEmitter<any>();
  readonly onDidChangeTreeData: Event<any> = this.onDidChangeEmitter.event;

  getTreeItem(element: CallHierarchyNode): TreeItem {
    let collapseState = TreeItemCollapsibleState.None
    if (element.numChildren > 0) {
      if (element.children.length > 0)
        collapseState = TreeItemCollapsibleState.Expanded;
      else
        collapseState = TreeItemCollapsibleState.Collapsed;
    }

    let light = '';
    let dark = '';
    if (element.callType == CallType.Base) {
      light = this.baseLight;
      dark = this.baseDark;
    } else if (element.callType == CallType.Derived) {
      light = this.derivedLight;
      dark = this.derivedDark;
    }

    let label = element.name;
    if (element.location) {
      let path = Uri.parse(element.location.uri).path;
      let name = path.substr(path.lastIndexOf('/') + 1);
      label += ` (${name}:${element.location.range.start.line + 1})`;
    }

    return {
      label: label,
      collapsibleState: collapseState,
      contextValue: 'cclsGoto',
      command: {
        command: 'ccls.hackGotoForTreeView',
        title: 'Goto',
        arguments: [element, element.numChildren > 0]
      },
      iconPath: { light: light, dark: dark }
    };
  }

  getChildren(element?: CallHierarchyNode): CallHierarchyNode[] | Thenable<CallHierarchyNode[]> {
    if (!this.root)
      return [];
    if (!element)
      return [this.root];
    if (element.numChildren == element.children.length)
      return element.children;

    return this.languageClient
      .sendRequest('$ccls/call', {
        id: element.id,
        callee: false,
        callType: CallType.All,
        qualified: false,
        levels: 1,
        hierarchy: true,
      })
      .then((result: CallHierarchyNode) => {
        element.children = result.children;
        return result.children;
      });
  }
}

export function activate(context: ExtensionContext, ccls: CclsClient) {
  let derivedDark =
    context.asAbsolutePath(path.join('resources', 'derived-dark.svg'));
  let derivedLight =
    context.asAbsolutePath(path.join('resources', 'derived-light.svg'));
  let baseDark =
    context.asAbsolutePath(path.join('resources', 'base-dark.svg'));
  let baseLight =
    context.asAbsolutePath(path.join('resources', 'base-light.svg'));
  const callHierarchyProvider = new CallHierarchyProvider(
    ccls.client, derivedDark, derivedLight, baseDark, baseLight);
  window.registerTreeDataProvider(
    'ccls.callHierarchy', callHierarchyProvider);
  commands.registerTextEditorCommand('ccls.callHierarchy', (editor) => {
    setContext('extension.ccls.callHierarchyVisible', true);
    let position = editor.selection.active;
    let uri = editor.document.uri;
    ccls.client
      .sendRequest('$ccls/call', {
        textDocument: {
          uri: uri.toString(),
        },
        position: position,
        callee: false,
        callType: 0x1 | 0x2,
        qualified: false,
        levels: 2,
        hierarchy: true,
      })
      .then((callNode: CallHierarchyNode) => {
        callHierarchyProvider.root = callNode;
        callHierarchyProvider.onDidChangeEmitter.fire();
      });
  });
  commands.registerCommand('ccls.closeCallHierarchy', (e) => {
    setContext('extension.ccls.callHierarchyVisible', false);
    callHierarchyProvider.root = undefined;
    callHierarchyProvider.onDidChangeEmitter.fire();
  });
}
