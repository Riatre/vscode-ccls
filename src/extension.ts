import { commands, ExtensionContext, StatusBarAlignment, window, workspace } from 'vscode';
import { Disposable } from 'vscode-jsonrpc';
import * as callHierarchy from './callHierarchy';
import { CclsClient } from './client';
import * as extraRefs from './extraRefs';
import * as fixIt from './fixIt';
import * as gotoForTreeView from './gotoForTreeView';
import * as inactiveRegions from './inactiveRegions';
import * as inheritanceHierarchy from './inheritanceHierarchy';
import * as codeLens from './codeLens';
import * as semanticHighlighting from './semanticHighlighting';

interface CclsInfoResult {
  db: {
    files: number;
    funcs: number;
    types: number;
    vars: number;
  },
  pipeline: {
    pendingIndexRequests: number;
  },
  project: {
    entries: number;
  }
};

function resolveVariables(value: any) {
  if (typeof value === 'string') {
    return value.replace('${workspaceFolder}', workspace.rootPath);
  } else if (Array.isArray(value)) {
    return value.map(resolveVariables);
  }
  return value;
}

function getInitializationOptions() {
  // Read prefs; this map goes from `ccls/js name` => `vscode prefs name`.
  const configMapping = [
    ['cacheDirectory', 'cacheDirectory'],
    ['compilationDatabaseCommand', 'misc.compilationDatabaseCommand'],
    ['compilationDatabaseDirectory', 'misc.compilationDatabaseDirectory'],
    ['clang.excludeArgs', 'clang.excludeArgs'],
    ['clang.extraArgs', 'clang.extraArgs'],
    ['clang.pathMappings', 'clang.pathMappings'],
    ['clang.resourceDir', 'clang.resourceDir'],
    ['codeLens.localVariables', 'codeLens.localVariables'],
    ['completion.caseSensitivity', 'completion.caseSensitivity'],
    ['completion.detailedLabel', 'completion.detailedLabel'],
    ['completion.duplicateOptional', 'completion.duplicateOptional'],
    ['completion.filterAndSort', 'completion.filterAndSort'],
    ['completion.include.maxPathSize', 'completion.include.maxPathSize'],
    ['completion.include.suffixWhitelist', 'completion.include.suffixWhitelist'],
    ['completion.include.whitelist', 'completion.include.whitelist'],
    ['completion.include.blacklist', 'completion.include.blacklist'],
    ['client.snippetSupport', 'completion.enableSnippetInsertion'],
    ['diagnostics.blacklist', 'diagnostics.blacklist'],
    ['diagnostics.whitelist', 'diagnostics.whitelist'],
    ['diagnostics.onChange', 'diagnostics.onChange'],
    ['diagnostics.onOpen', 'diagnostics.onOpen'],
    ['diagnostics.onSave', 'diagnostics.onSave'],
    ['diagnostics.spellChecking', 'diagnostics.spellChecking'],
    ['highlight.blacklist', 'highlight.blacklist'],
    ['highlight.whitelist', 'highlight.whitelist'],
    ['largeFileSize', 'highlight.largeFileSize'],
    ['index.whitelist', 'index.whitelist'],
    ['index.blacklist', 'index.blacklist'],
    ['index.initialWhitelist', 'index.initialWhitelist'],
    ['index.initialBlacklist', 'index.initialBlacklist'],
    ['index.multiVersion', 'index.multiVersion'],
    ['index.onChange', 'index.onChange'],
    ['index.threads', 'index.threads'],
    ['workspaceSymbol.maxNum', 'workspaceSymbol.maxNum'],
    ['workspaceSymbol.caseSensitivity', 'workspaceSymbol.caseSensitivity'],
  ];
  let initializationOptions = {
    cacheDirectory: '.ccls-cache',
    highlight: {
      lsRanges: true,
      blacklist: semanticHighlighting.hasAnySemanticHighlighting() ? undefined : ['.*'],
    },
    workspaceSymbol: {
      sort: false,
    },
  };
  let config = workspace.getConfiguration('ccls');
  for (let prop of configMapping) {
    let value = config.get(prop[1]);
    if (value != null) {
      let subprops = prop[0].split('.');
      let subconfig = initializationOptions;
      for (let subprop of subprops.slice(0, subprops.length - 1)) {
        if (!subconfig.hasOwnProperty(subprop)) {
          subconfig[subprop] = {};
        }
        subconfig = subconfig[subprop];
      }
      subconfig[subprops[subprops.length - 1]] = resolveVariables(value);
    }
  }
  return initializationOptions;
}

function setupStatusBar(_: ExtensionContext, ccls: CclsClient): Thenable<Disposable> {
  let icon = window.createStatusBarItem(StatusBarAlignment.Right);
  icon.text = 'ccls: loading';
  icon.tooltip = 'ccls is starting / loading project metadata';
  icon.show();

  return ccls.client.onReady().then(() => {
    return setInterval(() => {
      ccls.client.sendRequest('$ccls/info').then((info: CclsInfoResult) => {
        icon.text = `ccls: ${info.pipeline.pendingIndexRequests || 0} jobs`;
        icon.tooltip = `Statistics:
  ${info.db.files} files,
  ${info.db.funcs} functions,
  ${info.db.types} types,
  ${info.db.vars} variables,
  ${info.project.entries} entries in project.

  ${info.pipeline.pendingIndexRequests} pending index requests`;
      })
    }, 2000);
  }).then((timer) => {
    return {
      dispose() {
        clearInterval(timer);
        icon.dispose();
      }
    }
  });
}

export function activate(context: ExtensionContext) {
  let config = workspace.getConfiguration('ccls');
  let launchCommand: string = config.get('launch.command');
  let launchArgs: string[] = config.get('launch.args');
  let initializationOptions = getInitializationOptions();
  let traceEndpoint: string = config.get('trace.websocketEndpointUrl');
  if (!launchCommand || !initializationOptions)
    return;
  // Notify the user that if they change a ccls setting they need to restart
  // vscode.
  context.subscriptions.push(workspace.onDidChangeConfiguration(() => {
    let newConfig = getInitializationOptions();
    for (let key in newConfig) {
      if (!newConfig.hasOwnProperty(key))
        continue;

      if (!initializationOptions ||
          JSON.stringify(initializationOptions[key]) !=
              JSON.stringify(newConfig[key])) {
        const kReload = 'Reload'
        const message = `Please reload to apply the "ccls.${
            key}" configuration change.`;

        window.showInformationMessage(message, kReload).then(selected => {
          if (selected == kReload)
            commands.executeCommand('workbench.action.reloadWindow');
        });
        break;
      }
    }
  }));

  let middleware = {
    provideCodeLenses: codeLens.provideCodeLenses
  };
  let ccls = new CclsClient(
      launchCommand, launchArgs, initializationOptions, middleware,
      traceEndpoint);
  codeLens.activate(context, ccls);
  context.subscriptions.push(ccls.start());

  // General commands.
  commands.registerCommand('ccls.reload', () => {
    ccls.client.sendNotification('$ccls/reload');
  });
  setupStatusBar(context, ccls).then((d) => context.subscriptions.push(d));

  extraRefs.activate(context, ccls);
  fixIt.activate(context, ccls);
  inactiveRegions.activate(context, ccls);
  semanticHighlighting.activate(context, ccls);

  gotoForTreeView.activate(context, ccls);
  inheritanceHierarchy.activate(context, ccls);
  callHierarchy.activate(context, ccls);
}
