import { commands, ExtensionContext, window, workspace } from 'vscode';
import * as callHierarchy from './callHierarchy';
import { CclsClient } from './client';
import * as extraRefs from './extraRefs';
import * as fixIt from './fixIt';
import * as gotoForTreeView from './gotoForTreeView';
import * as inactiveRegions from './inactiveRegions';
import * as inheritanceHierarchy from './inheritanceHierarchy';
import * as semantichighlighting from './semanticHighlighting';


function resolveVariablesInString(value: string) {
  return value.replace('${workspaceFolder}', workspace.rootPath);
}

function resloveVariablesInArray(value: any[]) {
  return value.map(v => resolveVariables(v));
}

function resolveVariables(value: any) {
  if (typeof(value) == 'string') {
    return resolveVariablesInString(value);
  }
  if (Array.isArray(value)) {
      return resloveVariablesInArray(value);
  }
  return value;
}

function getInitializationOptions(context: ExtensionContext) {
  // Read prefs; this map goes from `ccls/js name` => `vscode prefs name`.
  let configMapping = [
    ['cacheDirectory', 'cacheDirectory'],
    ['index.whitelist', 'index.whitelist'],
    ['index.blacklist', 'index.blacklist'],
    ['clang.extraArgs', 'index.extraArgs'],
    ['clang.resourceDir', 'misc.resourceDirectory'],
    ['workspaceSymbol.maxNum', 'misc.maxWorkspaceSearchResults'],
    ['index.threads', 'misc.indexerCount'],
    ['index.enabled', 'misc.enableIndexing'],
    ['compilationDatabaseDirectory', 'misc.compilationDatabaseDirectory'],
    ['client.snippetSupport', 'completion.enableSnippetInsertion'],
    ['completion.includeMaxPathSize', 'completion.include.maximumPathLength'],
    ['completion.includeSuffixWhitelist', 'completion.include.whitelistLiteralEnding'],
    ['completion.includeWhitelist', 'completion.include.whitelist'],
    ['completion.includeBlacklist', 'completion.include.blacklist'],
    ['diagnostics.blacklist', 'diagnostics.blacklist'],
    ['diagnostics.whitelist', 'diagnostics.whitelist'],
    ['diagnostics.onOpen', 'diagnostics.onOpen'],
    ['diagnostics.onSave', 'diagnostics.onSave'],
    ['diagnostics.onChange', 'diagnostics.onType'],
    ['codeLens.localVariables', 'codeLens.onLocalVariables'],
  ];
  let initializationOptions = {
    cacheDirectory: '',
    highlight: {
      lsRanges: true,
      blacklist: semantichighlighting.hasAnySemanticHighlighting() ? '' : '.*',
    },
    workspaceSymbol: {
      sort: false,
    },
    completion: {
      detailedLabel: false,
      duplicateOptional: false,
    }
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

  // Set up a cache directory if there is not one.
  if (!initializationOptions.cacheDirectory) {
    if (!context.storagePath) {
      const kOpenSettings = 'Open Settings';
      window
          .showErrorMessage(
              'Could not auto-discover cache directory. Please use "Open Folder" ' +
                  'or specify it in the |ccls.cacheDirectory| setting.',
              kOpenSettings)
          .then((selected) => {
            if (selected == kOpenSettings)
              commands.executeCommand('workbench.action.openWorkspaceSettings');
          });
      return;
    }

    // Provide a default cache directory if it is not present. Insert next to
    // the project since if the user has an SSD they most likely have their
    // source files on the SSD as well.
    let cacheDir = '${workspaceFolder}/.ccls-cache/';
    initializationOptions.cacheDirectory = resolveVariables(cacheDir);
  }
  return initializationOptions;
}

export function activate(context: ExtensionContext) {
  let config = workspace.getConfiguration('ccls');
  let launchCommand: string = config.get('launch.command');
  let launchArgs: string[] = config.get('launch.args');
  let initializationOptions = getInitializationOptions(context);
  let traceEndpoint: string = config.get('trace.websocketEndpointUrl');
  if (!launchCommand || !initializationOptions)
    return;
  // Notify the user that if they change a ccls setting they need to restart
  // vscode.
  context.subscriptions.push(workspace.onDidChangeConfiguration(() => {
    let newConfig = getInitializationOptions(context);
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

  let ccls = new CclsClient(
      launchCommand, launchArgs, initializationOptions, undefined,
      traceEndpoint);
  context.subscriptions.push(ccls.start());

  // General commands.
  commands.registerCommand('ccls.reload', () => {
    ccls.client.sendNotification('$ccls/reload');
  });

  extraRefs.activate(context, ccls);
  fixIt.activate(context, ccls);
  inactiveRegions.activate(context, ccls);
  semantichighlighting.activate(context, ccls);
  
  gotoForTreeView.activate(context, ccls);
  inheritanceHierarchy.activate(context, ccls);
  callHierarchy.activate(context, ccls);
}
