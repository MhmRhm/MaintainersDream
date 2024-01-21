const os = require('os');
const path = require('path');
const fs = require('fs');

const vscode = require('vscode');
const imaps = require('imap-simple');
const simpleGit = require('simple-git');


let outputChannel;
function writeToOutputChannel(message) {
    outputChannel.appendLine(message);

    const config = vscode.workspace.getConfiguration('maintainersdream');
    if (config.get('showconsole', true)) {
        outputChannel.show(true);
    }
}

const readMail = async () => {
    let emails = new Map();

    const config = vscode.workspace.getConfiguration('maintainersdream');
    let mail_config = {
        imap: {
            user: config.get('user', ''),
            password: config.get('password', ''),
            host: config.get('host', ''),
            port: config.get('port', ''),
            authTimeout: 10000,
            tls: true,
            tlsOptions: { rejectUnauthorized: false }
        }
    };

    try {
        writeToOutputChannel(JSON.stringify(mail_config));
        const connection = await imaps.connect(mail_config);
        writeToOutputChannel('Mail Server Connection Successful' + new Date().toString());

        connection.getBoxes((error, mailboxes) => {
            if (error) {
                writeToOutputChannel(error.message);
                return;
            }
            writeToOutputChannel("Available Mailboxes (see settings):" + JSON.stringify(mailboxes));
        });

        await connection.openBox(config.get('inbox', 'Inbox'));
        const searchCriteria = ['ALL'];
        const fetchOptions = {
            bodies: ['HEADER', 'TEXT'],
            markSeen: false
        };

        const results = await connection.search(searchCriteria, fetchOptions);
        results.forEach((res) => {
            const header = res.parts.filter((part) => {
                return part.which === 'HEADER';
            });
            const body = res.parts.filter((part) => {
                return part.which === 'TEXT';
            });
            emails.set(res.attributes.uid, { sub: header[0].body.subject[0], msg: body[0].body });
        });

        connection.end();

    } catch (error) {
        writeToOutputChannel(error.message);
    }

    return emails;
};


class EmailItem extends vscode.TreeItem {
    constructor(id, sub, collapsibleState, contextValue) {
        super(sub, collapsibleState);
        this.id = id;
        this.contextValue = contextValue;
    }
}


class EmailDataProvider {
    constructor() {
        this.emails = new Map();
        this._onDidChangeTreeData = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._onDidChangeTreeData.event;
    }

    updateMailbox(view) {
        readMail().then((result) => {
            this.emails = result;
            this._onDidChangeTreeData.fire();
            if (view) {
                const config = vscode.workspace.getConfiguration('maintainersdream');
                view.title = config.get('user', '');
            }
        });
    }

    getTreeItem(element) {
        return element;
    }

    getChildren(element) {
        if (!element) {
            return Promise.resolve([
                new EmailItem(0, 'Inbox', vscode.TreeItemCollapsibleState.Collapsed)
            ]);
        } else {
            writeToOutputChannel("Inbox Updated");
            return Promise.resolve(
                Array.from(this.emails, ([id, email]) => (new EmailItem(id, email.sub, vscode.TreeItemCollapsibleState.None, "patch-item")))
            );
        }
    }

    getParent(element) {
        return null;
    }

    handleItemClick(item) {
        vscode.workspace.openTextDocument({
            language: 'diff',
            content: this.emails.get(item.id).msg
        }).then((document) => {
            vscode.window.showTextDocument(document, {
                viewColumn: vscode.ViewColumn.One,
                preserveFocus: true,
                preview: true,
                viewOptions: {
                    readOnly: true
                }
            });
        });
    }
}


/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
    outputChannel = vscode.window.createOutputChannel('Maintainers Dream');

    vscode.window.registerTreeDataProvider('mail-folders',
        new EmailDataProvider()
    );
    const treeDataProvider = new EmailDataProvider();
    const treeView = vscode.window.createTreeView('mail-folders', {
        treeDataProvider: treeDataProvider
    });

    treeView.onDidChangeSelection((event) => {
        const selectedItem = event.selection[0];
        if (selectedItem instanceof EmailItem) {
            treeDataProvider.handleItemClick(selectedItem);
        }
    });
    treeView.title = "Loading...";

    vscode.commands.registerCommand('maintainersdream.updatemailbox', () => {
        treeView.title = "Loading..."
        treeDataProvider.updateMailbox(treeView);
    });

    vscode.commands.registerCommand('maintainersdream.applypatch', async (email) => {
        try {
            const tempFolderPath = path.join(os.tmpdir(), 'my_temp_folder');
            if (!fs.existsSync(tempFolderPath)) {
                fs.mkdirSync(tempFolderPath);
            }
            const filePath = path.join(tempFolderPath, "temp.patch");
            fs.writeFileSync(filePath, treeDataProvider.emails.get(email.id).msg.replace(/\r\n/g, "\n"), {
                encoding: "utf8"
              });

            writeToOutputChannel("looking for repository at:" + vscode.workspace.workspaceFolders[0].uri.fsPath);

            const git = simpleGit(vscode.workspace.workspaceFolders[0].uri.fsPath);
            await git.applyPatch(filePath, {
                '--whitespace': 'fix',
                '--reject': null,
                '--verbose': null
            });

            writeToOutputChannel('Patch applied successfully.');

        } catch (error) {
            writeToOutputChannel('Error applying patch:' + error.message);
        }
    });
}

function deactivate() { }

module.exports = {
    activate,
    deactivate
}
