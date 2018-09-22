import { commands, Event, EventEmitter, ExtensionContext, TreeDataProvider, TreeItem, TreeItemCollapsibleState, Uri, window } from 'vscode';
import { LanguageClient } from 'vscode-languageclient/lib/main';
import * as ls from 'vscode-languageserver-types';
import { CclsClient } from './client';
import { setContext } from './utils';

class InheritanceHierarchyNode {
  id: any
  kind: number
  name: string
  location: ls.Location
  numChildren: number
  children: InheritanceHierarchyNode[]

  // If true and children need to be expanded derived will be used, otherwise
  // base will be used.
  _wantsDerived: boolean
  static setWantsDerived(node: InheritanceHierarchyNode, value: boolean) {
    node._wantsDerived = value;
    node.children.map(c => InheritanceHierarchyNode.setWantsDerived(c, value));
  }
}

class InheritanceHierarchyProvider implements
  TreeDataProvider<InheritanceHierarchyNode> {
  root: InheritanceHierarchyNode;

  readonly onDidChangeEmitter: EventEmitter<any> = new EventEmitter<any>();
  readonly onDidChangeTreeData: Event<any> = this.onDidChangeEmitter.event;

  constructor(readonly languageClient: LanguageClient) { }

  getTreeItem(element: InheritanceHierarchyNode): TreeItem {
    const kBaseName = '[[Base]]'

    let collapseState = TreeItemCollapsibleState.None
    if (element.numChildren > 0) {
      if (element.children.length > 0 && element.name != kBaseName)
        collapseState = TreeItemCollapsibleState.Expanded;
      else
        collapseState = TreeItemCollapsibleState.Collapsed;
    }

    let label = element.name;
    if (element.name != kBaseName && element.location) {
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
      }
    };
  }

  getChildren(element?: InheritanceHierarchyNode):
    InheritanceHierarchyNode[] | Thenable<InheritanceHierarchyNode[]> {
    if (!this.root)
      return [];
    if (!element)
      return [this.root];
    if (element.numChildren == element.children.length)
      return element.children;

    return this.languageClient
      .sendRequest('$ccls/inheritance', {
        id: element.id,
        kind: element.kind,
        derived: element._wantsDerived,
        qualified: false,
        levels: 1,
        hierarchy: true,
      })
      .then((result: InheritanceHierarchyNode) => {
        element.children = result.children;
        result.children.map(c => InheritanceHierarchyNode.setWantsDerived(c, element._wantsDerived));
        return result.children;
      });
  }
}

export function activate(context: ExtensionContext, ccls: CclsClient) {
  const inheritanceHierarchyProvider = new InheritanceHierarchyProvider(ccls.client);
  window.registerTreeDataProvider(
    'ccls.inheritanceHierarchy', inheritanceHierarchyProvider);
  commands.registerTextEditorCommand(
    'ccls.inheritanceHierarchy', (editor) => {
      setContext('extension.ccls.inheritanceHierarchyVisible', true);

      let position = editor.selection.active;
      let uri = editor.document.uri;
      ccls.client
        .sendRequest('$ccls/inheritance', {
          textDocument: {
            uri: uri.toString(),
          },
          position: position,
          derived: true,
          qualified: false,
          levels: 1,
          hierarchy: true,
        })
        .then((entry: InheritanceHierarchyNode) => {
          InheritanceHierarchyNode.setWantsDerived(entry, true);

          ccls.client
            .sendRequest('$ccls/inheritance', {
              id: entry.id,
              kind: entry.kind,
              derived: false,
              qualified: false,
              levels: 1,
              hierarchy: true,
            })
            .then((parentEntry: InheritanceHierarchyNode) => {
              if (parentEntry.numChildren > 0) {
                let parentWrapper = new InheritanceHierarchyNode();
                parentWrapper.children = parentEntry.children;
                parentWrapper.numChildren = parentEntry.children.length;
                parentWrapper.name = '[[Base]]';
                InheritanceHierarchyNode.setWantsDerived(
                  parentWrapper, false);
                entry.children.splice(0, 0, parentWrapper);
                entry.numChildren += 1;
              }

              inheritanceHierarchyProvider.root = entry;
              inheritanceHierarchyProvider.onDidChangeEmitter.fire();
            });
        })
    });
  commands.registerCommand('ccls.closeInheritanceHierarchy', () => {
    setContext('extension.ccls.inheritanceHierarchyVisible', false);
    inheritanceHierarchyProvider.root = undefined;
    inheritanceHierarchyProvider.onDidChangeEmitter.fire();
  });
}
