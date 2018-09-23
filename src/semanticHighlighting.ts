// Semantic highlighting
// TODO:
//   - enable bold/italic decorators, might need change in vscode
//   - only function call icon if the call is implicit

import { DecorationRangeBehavior, DecorationRenderOptions, ExtensionContext, Range, TextEditorDecorationType, window, workspace, TextEditor } from 'vscode';
import { CclsClient } from './client';
import { normalizeUri } from './utils';


type Nullable<T> = T|null;

enum SymbolKind {
  // lsSymbolKind
  Unknown = 0,
  File,
  Module,
  Namespace,
  Package,

  Class = 5,
  Method,
  Property,
  Field,
  Constructor,

  Enum = 10,
  Interface,
  Function,
  Variable,
  Constant,

  String = 15,
  Number,
  Boolean,
  Array,
  Object,

  Key = 20,
  Null,
  EnumMember,
  Struct,
  Event,

  Operator = 25,
  TypeParameter,

  // ccls extensions
  TypeAlias = 252,
  Parameter = 253,
  StaticMethod = 254,
  Macro = 255
}

enum StorageClass {
  Invalid,
  None,
  Extern,
  Static,
  PrivateExtern,
  Auto,
  Register
}

class SemanticSymbol {
  constructor(
      readonly stableId: number, readonly parentKind: SymbolKind,
      readonly kind: SymbolKind, readonly storage: StorageClass,
      readonly lsRanges: Array<Range>) {}
}

class PublishSemanticHighlightingArgs {
  readonly uri: string;
  readonly symbols: SemanticSymbol[];
}

function makeSemanticDecorationType(
    color: Nullable<string>, underline: boolean, italic: boolean,
    bold: boolean): TextEditorDecorationType {
  let opts: any = {};
  opts.rangeBehavior = DecorationRangeBehavior.ClosedClosed;
  opts.color = color;
  if (underline == true) opts.textDecoration = 'underline';
  if (italic == true) opts.fontStyle = 'italic';
  if (bold == true) opts.fontWeight = 'bold';
  return window.createTextEditorDecorationType(<DecorationRenderOptions>opts);
};

function makeDecorations(type: string) {
  let config = workspace.getConfiguration('ccls');
  let colors = config.get(`highlighting.colors.${type}`, []);
  let u = config.get(`highlighting.underline.${type}`, false);
  let i = config.get(`highlighting.italic.${type}`, false);
  let b = config.get(`highlighting.bold.${type}`, false);
  return colors.map(c => makeSemanticDecorationType(c, u, i, b));
};

let semanticDecorations = new Map<string, TextEditorDecorationType[]>();
let semanticEnabled = new Map<string, boolean>();

function updateConfigValues() {
  // Fetch new config instance, since vscode will cache the previous one.
  let config = workspace.getConfiguration('ccls');
  for (let [name] of semanticEnabled) {
    semanticEnabled.set(
        name, config.get(`highlighting.enabled.${name}`, false));
  }
};

function tryFindDecoration(symbol: SemanticSymbol):
    Nullable<TextEditorDecorationType> {
  function get(name: string) {
    if (!semanticEnabled.get(name)) return undefined;
    let decorations = semanticDecorations.get(name);
    return decorations[symbol.stableId % decorations.length];
  };

  if (symbol.kind == SymbolKind.Class || symbol.kind == SymbolKind.Struct) {
    return get('types');
  } else if (symbol.kind == SymbolKind.Enum) {
    return get('enums');
  } else if (symbol.kind == SymbolKind.TypeAlias) {
    return get('typeAliases');
  } else if (symbol.kind == SymbolKind.TypeParameter) {
    return get('templateParameters');
  } else if (symbol.kind == SymbolKind.Function) {
    return get('freeStandingFunctions');
  } else if (
      symbol.kind == SymbolKind.Method ||
      symbol.kind == SymbolKind.Constructor) {
    return get('memberFunctions')
  } else if (symbol.kind == SymbolKind.StaticMethod) {
    return get('staticMemberFunctions')
  } else if (symbol.kind == SymbolKind.Variable) {
    if (symbol.parentKind == SymbolKind.Function ||
        symbol.parentKind == SymbolKind.Method ||
        symbol.parentKind == SymbolKind.Constructor) {
      return get('freeStandingVariables');
    }
    return get('globalVariables');
  } else if (symbol.kind == SymbolKind.Field) {
    if (symbol.storage == StorageClass.Static) {
      return get('staticMemberVariables');
    }
    return get('memberVariables');
  } else if (symbol.kind == SymbolKind.Parameter) {
    return get('parameters');
  } else if (symbol.kind == SymbolKind.EnumMember) {
    return get('enumConstants');
  } else if (symbol.kind == SymbolKind.Namespace) {
    return get('namespaces');
  } else if (symbol.kind == SymbolKind.Macro) {
    return get('macros');
  }
};

export function hasAnySemanticHighlighting() {
  let options = [
    'ccls.highlighting.enabled.types',
    'ccls.highlighting.enabled.freeStandingFunctions',
    'ccls.highlighting.enabled.memberFunctions',
    'ccls.highlighting.enabled.freeStandingVariables',
    'ccls.highlighting.enabled.memberVariables',
    'ccls.highlighting.enabled.namespaces',
    'ccls.highlighting.enabled.macros',
    'ccls.highlighting.enabled.enums',
    'ccls.highlighting.enabled.typeAliases',
    'ccls.highlighting.enabled.enumConstants',
    'ccls.highlighting.enabled.staticMemberFunctions',
    'ccls.highlighting.enabled.parameters',
    'ccls.highlighting.enabled.templateParameters',
    'ccls.highlighting.enabled.staticMemberVariables',
    'ccls.highlighting.enabled.globalVariables'];
  let config = workspace.getConfiguration();
  for (let name of options) {
    if (config.get(name, false))
      return true;
  }
  return false;
}

let cachedSemanticHighlighting =
    new Map<string, Map<TextEditorDecorationType, Range[]>>();

function updateSemanticHighlightingForEditor(editor: TextEditor) {
  const uri = editor.document.uri.toString();
  if (!cachedSemanticHighlighting.has(uri)) return;

  // Clear decorations and set new ones. We might not use all of the
  // decorations so clear before setting.
  for (let [, decorations] of semanticDecorations) {
    decorations.forEach((type) => {
      editor.setDecorations(type, []);
    });
  }

  // Set new decorations.
  let decorations = cachedSemanticHighlighting.get(uri);
  decorations.forEach((ranges, type) => {
    editor.setDecorations(type, ranges);
  });
}

export function activate(context: ExtensionContext, ccls: CclsClient) {
  for (let type of
           ['types', 'freeStandingFunctions', 'memberFunctions',
            'freeStandingVariables', 'memberVariables', 'namespaces', 'macros',
            'enums', 'typeAliases', 'enumConstants', 'staticMemberFunctions',
            'parameters', 'templateParameters', 'staticMemberVariables',
            'globalVariables']) {
    semanticDecorations.set(type, makeDecorations(type));
    semanticEnabled.set(type, false);
  }

  updateConfigValues();

  ccls.client.onReady().then(() => {
    ccls.client.onNotification(
        '$ccls/publishSemanticHighlighting',
        (args: PublishSemanticHighlightingArgs) => {
          updateConfigValues();

          let decorations = new Map<TextEditorDecorationType, Array<Range>>();

          for (let symbol of args.symbols) {
            let type = tryFindDecoration(symbol);
            if (!type) continue;
            if (decorations.has(type)) {
              let existing = decorations.get(type);
              for (let range of symbol.lsRanges) existing.push(range);
            } else {
              decorations.set(type, symbol.lsRanges);
            }
          }

          const uri = normalizeUri(args.uri);
          cachedSemanticHighlighting.set(uri, decorations);

          for (let editor of window.visibleTextEditors) {
            if (editor.document.uri.toString() == uri) {
              updateSemanticHighlightingForEditor(editor);
            }
          }
        });
  });
  
  window.onDidChangeActiveTextEditor(updateSemanticHighlightingForEditor);

  workspace.onDidCloseTextDocument(document => {
    cachedSemanticHighlighting.delete(document.uri.toString());
  });
}
