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
            let checkClass = this.getNeeCheckSuperClass(ast.body);
            if (checkClass.length === 0) {
                return;
            }
            this.clearErrorInfo(document);
            this.checkOverrideFunc(ast.body, checkClass, document);
        }
        catch (error) {
            // console.log(error);
        }
    }
    pushDiagnosticInfo(doc, oriStr, errorInfo, level) {
        if (oriStr === undefined || errorInfo === undefined || level === undefined) {
            return;
        }
        let diagnostics = this.diagnosticCollection.get(doc.uri);
        let newdiagnostisc = [];
        if (diagnostics) {
            newdiagnostisc = diagnostics.slice(0);
        }
        console.log(oriStr, errorInfo);
        for (let lineIndex = 0; lineIndex < doc.lineCount; lineIndex++) {
            let lineOfText = doc.lineAt(lineIndex);
            if (lineOfText.text.includes(oriStr)) {
                let range = new vscode.Range(lineIndex, 0, lineIndex, lineOfText.text.length);
                let diagnostic = new vscode.Diagnostic(range, errorInfo, level);
                newdiagnostisc.push(diagnostic);
            }
        }
        this.diagnosticCollection.set(doc.uri, newdiagnostisc);
    }
    clearErrorInfo(doc) {
        if (this.diagnosticCollection.get(doc.uri)) {
            this.diagnosticCollection.delete(doc.uri);
        }
    }
    checkOverrideFunc(body, checkClasses, doc) {
        var _a;
        for (let obj of body) {
            if (obj.type !== 'FunctionDeclaration') {
                continue;
            }
            if (obj.type === 'FunctionDeclaration' && ((_a = obj.identifier) === null || _a === void 0 ? void 0 : _a.type) === "MemberExpression") {
                let memberExpression = obj.identifier;
                let funcName = memberExpression.identifier.name;
                let className = memberExpression.base.name;
                let superClassName = this.getSuperClassNameByClassName(checkClasses, className);
                if (superClassName === null) {
                    continue;
                }
                let superClassConfig = this.getConfigBySuperClassName(superClassName);
                if (superClassConfig === null) {
                    continue;
                }
                console.log(superClassConfig.overrideFunc);
                for (let overrideFuncName of superClassConfig.overrideFunc) {
                    if (funcName === overrideFuncName) {
                        console.log("检查", className, superClassName, funcName);
                        let checkResult = this.checkFuncBody(obj, className, funcName);
                        //检查没有写调用父类函数
                        if (!checkResult.hasError && !checkResult.hasCalledSuperFunc) {
                            let oriExpression = className + ':' + funcName;
                            this.pushDiagnosticInfo(doc, oriExpression, "请增加" + className + ".super." + funcName + "(self)", vscode.DiagnosticSeverity.Error);
                        }
                        else if (!checkResult.hasCalledSuperFunc) {
                            this.pushDiagnosticInfo(doc, checkResult.oriExpression, checkResult.info, checkResult.level);
                        }
                    }
                }
            }
        }
    }
    getSuperClassNameByClassName(checkClasses, className) {
        for (let checkClass of checkClasses) {
            if (checkClass.name === className) {
                return checkClass.superName;
            }
        }
        return null;
    }
    getConfigBySuperClassName(superClassName) {
        for (let config of this.configs) {
            if (config.name === superClassName) {
                return config;
            }
        }
        return null;
    }
    checkFuncBody(functionDecl, className, checkFuncName) {
        //检查 写了父类,但是写法不正确的情况
        let checkResult = { hasError: false, hasCalledSuperFunc: false };
        for (let body of functionDecl.body) {
            if (checkResult.hasError || checkResult.hasCalledSuperFunc) {
                break;
            }
            if (body.type === 'IfStatement') {
                for (let clause of body.clauses) {
                    if (checkResult.hasError || checkResult.hasCalledSuperFunc) {
                        break;
                    }
                    let clauseBody = clause.body;
                    for (let statement of clauseBody) {
                        if (statement.type === 'CallStatement') {
                            checkResult = this.checkCallStatement(statement, className, checkFuncName);
                            if (checkResult.hasError || checkResult.hasCalledSuperFunc) {
                                break;
                            }
                        }
                    }
                }
            }
            else if (body.type === 'CallStatement') {
                //CallStatement里面情况有直接调用父类函数,还有在回调函数调用
                checkResult = this.checkCallStatement(body, className, checkFuncName);
            }
        }
        return checkResult;
    }
    checkCallStatement(statement, className, checkFuncName) {
        let callexpression = statement.expression;
        if (callexpression.base.type !== 'MemberExpression') {
            return { hasError: false, hasCalledSuperFunc: false };
        }
        let memberExpression = callexpression.base;
        let funcName = memberExpression.identifier.name;
        if (funcName === checkFuncName && memberExpression.base.type === 'MemberExpression') {
            let memberExpressionBase = memberExpression.base;
            let callerName = memberExpressionBase.base.name;
            let propertyName = memberExpressionBase.identifier.name;
            //确定调用函数用的是 . 还是 : 
            let callFuncSign = memberExpression.indexer;
            let params = callexpression.arguments;
            //写了xxx.super.checkFuncName才去检查
            if (propertyName === 'super') {
                let oriExpression = callerName + '.' + propertyName + callFuncSign + checkFuncName;
                if (callerName !== className || callFuncSign !== '.' || params.length === 0) {
                    // this.pushErrorInfo(doc,oriExpression,"1请改成"+className+".super."+checkFuncName+"(self)");
                    return { hasError: true, hasCalledSuperFunc: false, level: vscode.DiagnosticSeverity.Error, oriExpression: oriExpression, info: "正确写法: " + className + ".super." + checkFuncName + "(self)" };
                }
                if (params.length > 0) {
                    let firstParam = params[0].name;
                    if (firstParam !== 'self') {
                        return { hasError: true, hasCalledSuperFunc: false, level: vscode.DiagnosticSeverity.Error, oriExpression: oriExpression, info: " 正确写法:" + className + ".super." + checkFuncName + "(self)" };
                    }
                    else {
                        console.log("检查到父类函数", oriExpression);
                        return { hasError: false, hasCalledSuperFunc: true };
                    }
                }
            }
        }
        else {
            //把父类函数通过匿名函数传递到其他函数使用检测
            let params = callexpression.arguments;
            for (let param of params) {
                if (param.type === 'FunctionDeclaration') {
                    let cunctionDeclaration = param;
                    return this.checkFuncBody(cunctionDeclaration, className, checkFuncName);
                }
            }
        }
        return { hasError: false, hasCalledSuperFunc: false };
    }
    //获得文件内所有要检查的类
    getNeeCheckSuperClass(body) {
        if (this.configs.length === 0) {
            return [];
        }
        // console.log(body);
        let needCheckClass = [];
        let reg = new RegExp('"', "g");
        for (let obj of body) {
            if (obj.type !== 'LocalStatement') {
                continue;
            }
            let localStatement = obj;
            for (let child of localStatement.init) {
                let callExpression = child;
                if (callExpression.type === 'CallExpression' && callExpression.base.name === 'class') {
                    // console.log(obj);
                    let args = callExpression.arguments;
                    if (args.length < 2) {
                        continue;
                    }
                    //仅支持单继承检测
                    let argClassName = args[0].raw;
                    argClassName = argClassName.replace(reg, "");
                    let className = obj.variables[0].name;
                    // console.log("className = "+ className+"   "+argClassName);
                    let superClass = args[1];
                    if (superClass.type === 'CallExpression' && (superClass.base.name === 'require' || superClass.base.name === 'import')) {
                        let requireArgs = superClass.arguments;
                        if (requireArgs.length > 0) {
                            let firstArg = requireArgs[0];
                            for (let config of this.configs) {
                                let superClassName = firstArg.raw.replace(reg, "");
                                if (superClassName === config.name) {
                                    // superClassName = config.name;
                                    needCheckClass.push({ name: className, superName: config.name });
                                    break;
                                }
                            }
                        }
                    }
                }
            }
        }
        return needCheckClass;
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
        console.log("onDidSaveTextDocument");
        PyLuaCheck.instance.startCheck(event);
    }));
    context.subscriptions.push(vscode.workspace.onDidOpenTextDocument(event => {
        console.log("onDidOpenTextDocument");
        PyLuaCheck.instance.startCheck(event);
    }));
    context.subscriptions.push(vscode.workspace.onDidCloseTextDocument(event => {
        console.log("onDidCloseTextDocument");
        PyLuaCheck.instance.startCheck(event);
    }));
    context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(event => {
        console.log("onDidChangeActiveTextEditor");
        PyLuaCheck.instance.startCheck(event === null || event === void 0 ? void 0 : event.document);
    }));
}
exports.registerCheckLua = registerCheckLua;
;
//# sourceMappingURL=luacheck.js.map