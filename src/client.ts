import { OutputChannel } from "vscode";
import { LanguageClient, LanguageClientOptions, Middleware, RevealOutputChannelOn, ServerOptions } from "vscode-languageclient";
import * as WebSocket from 'ws';

function getTraceOutputChannel(traceEndpoint?: string): OutputChannel {
  if (!traceEndpoint) return undefined;
  let socket = new WebSocket(traceEndpoint);
  let log = '';
  return {
    name: 'websocket',
    append(value: string) {
      log += value;
    },
    appendLine(value: string) {
      log += value;
      if (socket && socket.readyState == WebSocket.OPEN) {
        socket.send(log);
      }
      log = '';
    },
    clear() { },
    show() { },
    hide() { },
    dispose() { }
  };
}

export class CclsClient {
  client: LanguageClient | null;

  private launchCommand: string;
  private launchArgs: string[];
  private initializationOptions: any;
  private middleware: Middleware | undefined;
  private traceEndpoint: string | undefined;

  constructor(
      launchCommand: string, launchArgs: string[], initializationOptions: any,
      middleware?: Middleware, traceEndpoint?: string) {
    this.launchCommand = launchCommand;
    this.launchArgs = launchArgs;
    this.initializationOptions = initializationOptions;
    this.middleware = middleware;
    this.traceEndpoint = traceEndpoint;
    this.client = null;
  }

  start() {
    if (this.client) return;

    let clientOptions: LanguageClientOptions = {
      documentSelector: [
        {language: 'c', scheme: 'file'},
        {language: 'cpp', scheme: 'file'},
        {language: 'objective-c', scheme: 'file'},
        {language: 'objective-cpp', scheme: 'file'},
      ],
      diagnosticCollectionName: 'ccls',
      outputChannelName: 'ccls',
      revealOutputChannelOn: RevealOutputChannelOn.Never,
      initializationOptions: this.initializationOptions,
      middleware: this.middleware,
      initializationFailedHandler: (e) => {
        console.log(e);
        return false;
      },
      outputChannel: getTraceOutputChannel(this.traceEndpoint),
    };

    let env: any = {};
    let kToForward = [
      'ProgramData',
      'PATH',
      'CPATH',
      'LIBRARY_PATH',
    ];
    for (let e of kToForward) env[e] = process.env[e];

    let serverOptions: ServerOptions = {
      command: this.launchCommand,
      args: this.launchArgs,
      options: {env: env}
    };
    console.log(`Starting ${serverOptions.command}`);
    this.client =
        new LanguageClient('ccls', 'ccls', serverOptions, clientOptions);
    return this.client.start();
  }

  restart() {
    return this.client.stop().then(() => {
      this.client = null;
      this.start();
    });
  }
}
