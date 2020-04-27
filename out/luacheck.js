"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vscode = require("vscode");
const luaparse = require("luaparse");
// import { type } from 'os';
function getextname(filename) {
    if (!filename || typeof filename !== 'string') {
        return null;
    }
    ;
    let a = filename.split('').reverse().join('');
    let b = a.substring(0, a.search(/\./)).split('').reverse().join('');
    return b;
}
class PyLuaCheck {
    constructor(diagnosticCollection) {
        this.diagnosticCollection = diagnosticCollection;
        PyLuaCheck.instance = this;
        this.configs = vscode.workspace.getConfiguration("pyluacheck").get("checkClass", []);
    }
    startCheck(document) {
        if (!document) {
            return;
        }
        let extname = getextname(document.fileName);
        if (extname === null || extname !== "lua") {
            return;
        }
        let content = document.getText();
        try {
            let ast = luaparse.parse(content, { comments: false });
            // console.log(ast.body);
            if (!this.isContainSuperClass(ast.body)) {
                return;
            }
            ;
            this.clearErrorInfo(document);
            this.checkOverrideFunc(ast.body, document);
        }
        catch (error) {
            // console.log(error);
        }
    }
    pushErrorInfo(doc, oriStr, errorInfo) {
        let diagnostics = this.diagnosticCollection.get(doc.uri);
        let newdiagnostisc = [];
        if (diagnostics) {
            newdiagnostisc = diagnostics.slice(0);
        }
        console.log(oriStr, errorInfo);
        for (let lineIndex = 0; lineIndex < doc.lineCount; lineIndex++) {
            let lineOfText = doc.lineAt(lineIndex);
            if (lineOfText.text.includes(oriStr)) {
                newdiagnostisc.push(this.createDiagnostic(doc, lineOfText, lineIndex, errorInfo));
            }
        }
        this.diagnosticCollection.set(doc.uri, newdiagnostisc);
    }
    clearErrorInfo(doc) {
        console.log("清空");
        if (this.diagnosticCollection.get(doc.uri)) {
            this.diagnosticCollection.delete(doc.uri);
        }
    }
    createDiagnostic(doc, lineOfText, lineIndex, errorInfo) {
        // find where in the line of thet the 'emoji' is mentioned
        //    let index = lineOfText.text.indexOf(EMOJI);
        // create range that represents, where in the document the word is
        let range = new vscode.Range(lineIndex, 0, lineIndex, lineOfText.text.length);
        let diagnostic = new vscode.Diagnostic(range, errorInfo, vscode.DiagnosticSeverity.Error);
        //    diagnostic.code = EMOJI_MENTION;
        return diagnostic;
    }
    checkOverrideFunc(body, doc) {
        var _a;
        for (let obj of body) {
            if (obj.type !== 'FunctionDeclaration') {
                continue;
            }
            if (obj.type === 'FunctionDeclaration' && ((_a = obj.identifier) === null || _a === void 0 ? void 0 : _a.type) === "MemberExpression") {
                let memberExpression = obj.identifier;
                let funcName = memberExpression.identifier.name;
                for (let config of this.configs) {
                    for (let overrideFuncName of config.overrideFunc) {
                        if (funcName === overrideFuncName) {
                            this.checkFuncBody(obj, funcName, doc);
                        }
                    }
                }
            }
        }
    }
    checkFuncBody(functionDecl, checkFuncName, doc) {
        let className = functionDecl.identifier.base.name;
        let hasError = false;
        let hasCheck = false;
        //检查 写了父类,但是写法不正确的情况
        for (let body of functionDecl.body) {
            if (body.type === 'CallStatement' && body.expression.base.type === 'MemberExpression'
                && body.expression.base.identifier.name === checkFuncName) {
                hasCheck = true;
                let callexpression = body.expression;
                let nemberExpression = callexpression.base;
                let callerName = nemberExpression.base.base.name;
                let midName = nemberExpression.base.identifier.name;
                let sign = nemberExpression.indexer;
                let params = callexpression.arguments;
                let oriExpression = callerName + '.' + midName + sign + checkFuncName;
                if (callerName !== className || midName !== 'super' || sign !== '.' || params.length === 0) {
                    this.pushErrorInfo(doc, oriExpression, "请改成" + className + ".super." + checkFuncName + "(self)");
                    hasError = true;
                    break;
                }
                if (params.length > 0) {
                    let firstParam = params[0].name;
                    if (firstParam !== 'self') {
                        this.pushErrorInfo(doc, oriExpression, "请改成" + className + ".super." + checkFuncName + "(self)");
                        hasError = true;
                        break;
                    }
                }
            }
        }
        //检查没有写调用父类函数
        if (!hasCheck) {
            let oriExpression = className + ':' + checkFuncName;
            this.pushErrorInfo(doc, oriExpression, "请增加" + className + ".super." + checkFuncName + "(self)");
            hasError = true;
        }
        if (hasError === false) {
            //清空当前
            // this.clearErrorInfo(doc);
        }
    }
    isContainSuperClass(body) {
        if (this.configs.length === 0) {
            return false;
        }
        // console.log(body);
        let isCheck = false;
        for (let obj of body) {
            if (isCheck) {
                break;
            }
            if (obj.type !== 'LocalStatement') {
                continue;
            }
            let localStatement = obj;
            for (let child of localStatement.init) {
                if (isCheck) {
                    break;
                }
                let callExpression = child;
                if (callExpression.type === 'CallExpression' && callExpression.base.name === 'class') {
                    let args = callExpression.arguments;
                    if (args.length === 0) {
                        continue;
                    }
                    //仅支持单继承检测
                    let superClass = args[1];
                    if (superClass.type === 'CallExpression' && (superClass.base.name === 'require' || superClass.base.name === 'import')) {
                        let requireArgs = superClass.arguments;
                        if (requireArgs.length > 0) {
                            let firstArg = requireArgs[0];
                            // console.log(firstArg);
                            for (let config of this.configs) {
                                if (firstArg.raw.indexOf(config.name) !== -1) {
                                    isCheck = true;
                                    break;
                                }
                            }
                        }
                    }
                }
            }
        }
        return isCheck;
    }
}
function registerCheckLua(context) {
    const collection = vscode.languages.createDiagnosticCollection('pyluacheck');
    context.subscriptions.push(collection);
    new PyLuaCheck(collection);
    // context.subscriptions.push(vscode.workspace.onDidChangeTextDocument((event)=>{
    //     PyLuaCheck.instance.startCheck(event.document);
    // }));
    context.subscriptions.push(vscode.workspace.onDidSaveTextDocument(event => {
        PyLuaCheck.instance.startCheck(event);
    }));
    context.subscriptions.push(vscode.workspace.onDidOpenTextDocument(event => {
        PyLuaCheck.instance.startCheck(event);
    }));
    context.subscriptions.push(vscode.workspace.onDidCloseTextDocument(event => {
        PyLuaCheck.instance.startCheck(event);
    }));
    context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(event => {
        PyLuaCheck.instance.startCheck(event === null || event === void 0 ? void 0 : event.document);
    }));
}
exports.registerCheckLua = registerCheckLua;
;
//# sourceMappingURL=luacheck.js.map