import * as vscode from 'vscode';
import * as luaparse from 'luaparse';
import { Statement } from 'luaparse';
// import { type } from 'os';

function getextname(filename:string):string| null{
    if(!filename||typeof filename!=='string'){
        return null;
     };
     let a = filename.split('').reverse().join('');
     let b = a.substring(0,a.search(/\./)).split('').reverse().join('');
     return b;
}


interface CheckConfig 
{
    name:string;
    overrideFunc:string[];
}

interface CheckClass
{
    name:string;
    superName:string;
}

interface CheckResult{
    hasError:boolean,
    hasCalledSuperFunc:boolean,
    level?:vscode.DiagnosticSeverity,
    oriExpression?:string,
    info?:string
}
class PyLuaCheck {
    public static instance:PyLuaCheck;
    public diagnosticCollection: vscode.DiagnosticCollection;
    private configs:CheckConfig[];
    constructor(diagnosticCollection: vscode.DiagnosticCollection){
        this.diagnosticCollection = diagnosticCollection;
        PyLuaCheck.instance = this;
        this.configs = vscode.workspace.getConfiguration("pyluacheck").get("checkClass",[]);
    }

    public startCheck(document?:vscode.TextDocument):void {

        if(!document){return;}

        let extname = getextname(document.fileName);
        if(extname===null || extname!=="lua"){return;}
        let content:string = document.getText();
        try {
            
            let ast:luaparse.Chunk = luaparse.parse(content,{comments: false});
            // console.log(ast.body);
            let checkClass = this.getNeeCheckSuperClass(ast.body);
            if(checkClass.length === 0)
            {
                return;
            }
        
            this.clearErrorInfo(document);
            this.checkOverrideFunc(ast.body,checkClass,document);
        } catch (error) {
            // console.log(error);
        }
    }

   
    private pushDiagnosticInfo(doc:vscode.TextDocument,oriStr?:string,errorInfo?:string,level?:vscode.DiagnosticSeverity):void {

        if (oriStr===undefined||errorInfo===undefined ||level===undefined){return;}

        let diagnostics = this.diagnosticCollection.get(doc.uri);
        let newdiagnostisc: vscode.Diagnostic[] = [];
        if(diagnostics)
        {
            newdiagnostisc = diagnostics.slice(0);
        }
        console.log(oriStr,errorInfo);
        for (let lineIndex = 0; lineIndex < doc.lineCount; lineIndex++) {
            let lineOfText = doc.lineAt(lineIndex);
            if (lineOfText.text.includes(oriStr)) {

                let range = new vscode.Range(lineIndex, 0, lineIndex,lineOfText.text.length );
   
                let diagnostic = new vscode.Diagnostic(range, errorInfo,level);

                newdiagnostisc.push(diagnostic);
            }
        }
        this.diagnosticCollection.set(doc.uri,newdiagnostisc);
    }
   
    private clearErrorInfo(doc:vscode.TextDocument):void{
        if(this.diagnosticCollection.get(doc.uri)){
            this.diagnosticCollection.delete(doc.uri);
        }
    }

    private checkOverrideFunc(body:luaparse.Statement[],checkClasses:CheckClass[],doc:vscode.TextDocument):void{
        for (let obj of body) {
            if(obj.type !== 'FunctionDeclaration'){continue;}
            if(obj.type==='FunctionDeclaration' && (obj as luaparse.FunctionDeclaration).identifier?.type==="MemberExpression" ){
                let memberExpression = (obj as luaparse.FunctionDeclaration).identifier as luaparse.MemberExpression;
                let funcName:string =  memberExpression.identifier.name;
                let className:string = (memberExpression.base as luaparse.Identifier).name;

                let superClassName = this.getSuperClassNameByClassName(checkClasses,className);
                if(superClassName===null) {continue;}
                let superClassConfig = this.getConfigBySuperClassName(superClassName);
                if(superClassConfig===null) {continue;}
                console.log(superClassConfig.overrideFunc);
                for(let overrideFuncName of superClassConfig.overrideFunc){
                    if(funcName ===overrideFuncName ){
                        console.log("检查",className,superClassName,funcName);
                        let checkResult:CheckResult = this.checkFuncBody(obj,className,funcName);

                        //检查没有写调用父类函数
                        if(!checkResult.hasError && !checkResult.hasCalledSuperFunc){
                            let oriExpression = className+':'+funcName;
                            this.pushDiagnosticInfo(doc,oriExpression,"请增加"+className+".super."+funcName+"(self)",vscode.DiagnosticSeverity.Error);
                        }
                        else if(!checkResult.hasCalledSuperFunc) {
                            this.pushDiagnosticInfo(doc,checkResult.oriExpression,checkResult.info,checkResult.level);
                        }
                    }
                }
            }
        }
    }

    private getSuperClassNameByClassName(checkClasses:CheckClass[],className:string):string|null {
        for(let checkClass of checkClasses){
            if(checkClass.name===className)
            {
                return checkClass.superName;
            }
        }
        return null;
    }

    private getConfigBySuperClassName(superClassName:string):CheckConfig|null{
        for(let config of this.configs)
        {
            if (config.name === superClassName)
            {
                return config;
            }
        }
        return null;
    }

    private checkFuncBody(functionDecl:luaparse.FunctionDeclaration,
            className:string,checkFuncName:string):CheckResult {

        //检查 写了父类,但是写法不正确的情况
        
        let checkResult:CheckResult = {hasError:false,hasCalledSuperFunc:false};

        for (let body of functionDecl.body) {
            if(checkResult.hasError || checkResult.hasCalledSuperFunc){
                break;
            }

            if(body.type==='IfStatement'){
                for(let clause of body.clauses){
                    if(checkResult.hasError || checkResult.hasCalledSuperFunc){
                        break;
                    }
                    let clauseBody:Statement[] = clause.body;
                    for(let statement of clauseBody){
                        if(statement.type === 'CallStatement'){
                            checkResult = this.checkCallStatement(statement,className,checkFuncName);
                            if(checkResult.hasError || checkResult.hasCalledSuperFunc){
                                break;
                            }
                        }
                    }
                }
            }
            else if(body.type === 'CallStatement'){
                //CallStatement里面情况有直接调用父类函数,还有在回调函数调用
                checkResult = this.checkCallStatement(body,className,checkFuncName);
            }
        }
       
        return checkResult;
    }



    private checkCallStatement(statement:luaparse.CallStatement,className:string,checkFuncName:string):CheckResult {

        let callexpression = statement.expression as luaparse.CallExpression;
        if (callexpression.base.type !== 'MemberExpression' ){
            return  {hasError:false,hasCalledSuperFunc:false};
        }
        let memberExpression = callexpression.base as luaparse.MemberExpression;
        let funcName = memberExpression.identifier.name;

  
        if (funcName === checkFuncName && memberExpression.base.type === 'MemberExpression'){
            let memberExpressionBase = (memberExpression.base as luaparse.MemberExpression);
            let callerName = (memberExpressionBase.base as luaparse.Identifier).name;
            let propertyName = (memberExpressionBase.identifier as luaparse.Identifier).name;
            //确定调用函数用的是 . 还是 : 
            let callFuncSign = memberExpression.indexer;
            let params = callexpression.arguments as luaparse.Expression[];
            //写了xxx.super.checkFuncName才去检查
            if (propertyName === 'super'){

                let oriExpression = callerName + '.' + propertyName + callFuncSign + checkFuncName;
                if(callerName !== className|| callFuncSign !== '.'||params.length===0){
                    // this.pushErrorInfo(doc,oriExpression,"1请改成"+className+".super."+checkFuncName+"(self)");
                    return {hasError:true,hasCalledSuperFunc:false,level:vscode.DiagnosticSeverity.Error,oriExpression:oriExpression,info:"正确写法: "+className+".super."+checkFuncName+"(self)"};
                }

                if(params.length>0){
                    let firstParam = (params[0] as luaparse.Identifier).name;
                    if(firstParam!=='self'){
                        return {hasError:true,hasCalledSuperFunc:false,level:vscode.DiagnosticSeverity.Error,oriExpression:oriExpression,info:" 正确写法:"+className+".super."+checkFuncName+"(self)"};
                    }
                    else{
                        console.log("检查到父类函数",oriExpression);
                        return {hasError:false,hasCalledSuperFunc:true};
                    }
                }
            }
        }
        else {
            //把父类函数通过匿名函数传递到其他函数使用检测

            let params = callexpression.arguments as luaparse.Expression[];
            for (let param of params) {
                if(param.type ==='FunctionDeclaration' ){
                    let cunctionDeclaration = param as luaparse.FunctionDeclaration;
                    
                    return this.checkFuncBody(cunctionDeclaration,className,checkFuncName);
                }
            }
        }

        

        return  {hasError:false,hasCalledSuperFunc:false};
    }
        


    //获得文件内所有要检查的类
    private getNeeCheckSuperClass(body:luaparse.Statement[]):CheckClass[] {
        if(this.configs.length === 0) {return [];}
        // console.log(body);
        let needCheckClass:CheckClass[] = [];
        let reg = new RegExp('"',"g");  
        for (let obj of body) {
            if(obj.type !== 'LocalStatement'){continue;}
            let localStatement:luaparse.LocalStatement = obj as luaparse.LocalStatement;
            for(let child of localStatement.init)
            {
                let callExpression:luaparse.CallExpression = child as luaparse.CallExpression;
                if(callExpression.type === 'CallExpression' && (callExpression.base as luaparse.Identifier).name ==='class')
                {
                    // console.log(obj);
                    let args: luaparse.Expression[] = callExpression.arguments as luaparse.Expression[];
                    if(args.length<2){continue;}
                    //仅支持单继承检测

                    let argClassName:string = (args[0] as luaparse.StringLiteral).raw;
                    
                    argClassName = argClassName.replace(reg, "");

                    let className = obj.variables[0].name;


                    // console.log("className = "+ className+"   "+argClassName);
                    let superClass:luaparse.CallExpression = args[1] as luaparse.CallExpression;
                    if(superClass.type==='CallExpression'&& ((superClass.base as luaparse.Identifier).name==='require' || (superClass.base as luaparse.Identifier).name==='import'))
                    {
                        let requireArgs:luaparse.Expression[] = superClass.arguments as luaparse.Expression[];
                        if(requireArgs.length>0)
                        {
                            let firstArg:luaparse.StringLiteral = requireArgs[0] as luaparse.StringLiteral;
                            for(let config of this.configs)
                            {
                                let superClassName = firstArg.raw.replace(reg, "");

                                if( superClassName ===config.name)
                                {
                                    // superClassName = config.name;
                                    needCheckClass.push( {name:className,superName:config.name});

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


export function registerCheckLua(context: vscode.ExtensionContext):void {

    const collection:vscode.DiagnosticCollection = vscode.languages.createDiagnosticCollection('pyluacheck');
   
    context.subscriptions.push(collection);
    new PyLuaCheck(collection);
    // context.subscriptions.push(vscode.workspace.onDidChangeTextDocument((event)=>{
    //     PyLuaCheck.instance.startCheck(event.document);
    // }));
    context.subscriptions.push(vscode.workspace.onDidSaveTextDocument(event=>{
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
        
        PyLuaCheck.instance.startCheck(event?.document);
    }));

};
