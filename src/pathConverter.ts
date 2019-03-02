import { Disposable, Uri, workspace } from "vscode";
import { URIConverter as Code2ProtocolURIConverter } from "vscode-languageclient/lib/codeConverter";
import { URIConverter as Protocol2CodeURIConverter } from "vscode-languageclient/lib/protocolConverter";

export interface ClientUriPrefixConversionRule {
  clientUri: string;
  server: string;
}

export interface ConversionRule {
  client: string;
  server: string;
}

type ConfigurationConversionRule = ConversionRule | ClientUriPrefixConversionRule;

function isClientUriPrefixConversionRule(arg: any): arg is ClientUriPrefixConversionRule {
  return arg.clientUri !== undefined;
}

export class PathConverterProvider implements Disposable {
  public protocol2Code: Protocol2CodeURIConverter;
  public code2Protocol: Code2ProtocolURIConverter;

  private rules: ConversionRule[];

  public constructor() {
    this.protocol2Code = this._protocol2Code.bind(this);
    this.code2Protocol = this._code2Protocol.bind(this);

    // Caveat: WorkspaceConfiguration.get is nullable!
    const rules = workspace
      .getConfiguration("ccls")
      .get<ConfigurationConversionRule[]>("misc.pathConversionRules", []) || [];
    this.rules = rules.map((rule) => {
      return {
        client: isClientUriPrefixConversionRule(rule)
          ? Uri.parse(rule.clientUri).toString()
          : Uri.file(rule.client).toString(),
        server: Uri.file(rule.server).toString()
      };
    });
  }

  public dispose() {
    /**/
  }

  private _protocol2Code(uri: string): Uri {
    this.rules.forEach((rule) => {
      if (uri.startsWith(rule.server)) {
        uri = rule.client + uri.slice(rule.server.length);
      }
    });
    return Uri.parse(uri);
  }

  private _code2Protocol(uri: Uri): string {
    let puri = uri.toString();
    this.rules.forEach((rule) => {
      if (puri.startsWith(rule.client)) {
        puri = rule.server + puri.slice(rule.client.length);
      }
    });
    return puri;
  }
}
