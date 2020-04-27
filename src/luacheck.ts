import * as vscode from 'vscode';
import * as luaparse from 'luaparse';
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
            if(!this.isContainSuperClass(ast.body)){
                
                return;
            };
            this.clearErrorInfo(document);
            this.checkOverrideFunc(ast.body,document);
        } catch (error) {
            // console.log(error);
        }
    }

   
    private pushErrorInfo(doc:vscode.TextDocument,oriStr:string,errorInfo:string):void {
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
                newdiagnostisc.push(this.createDiagnostic(doc, lineOfText, lineIndex,errorInfo));
            }
        }
        this.diagnosticCollection.set(doc.uri,newdiagnostisc);
    }
   
    private clearErrorInfo(doc:vscode.TextDocument)
    {
        console.log("清空");
        if(this.diagnosticCollection.get(doc.uri))
        {
            this.diagnosticCollection.delete(doc.uri);
        }
    }
   private createDiagnostic(doc: vscode.TextDocument, lineOfText: vscode.TextLine, lineIndex: number,errorInfo:string): vscode.Diagnostic {
       // find where in the line of thet the 'emoji' is mentioned
    //    let index = lineOfText.text.indexOf(EMOJI);
   
       // create range that represents, where in the document the word is
       let range = new vscode.Range(lineIndex, 0, lineIndex,lineOfText.text.length );
   
       let diagnostic = new vscode.Diagnostic(range, errorInfo,
           vscode.DiagnosticSeverity.Error);
    //    diagnostic.code = EMOJI_MENTION;
       return diagnostic;
   }
    private checkOverrideFunc(body:luaparse.Statement[],doc:vscode.TextDocument):void{
        for (let obj of body) {
            if(obj.type !== 'FunctionDeclaration'){continue;}

            if(obj.type==='FunctionDeclaration' && (obj as luaparse.FunctionDeclaration).identifier?.type==="MemberExpression" ){

                let memberExpression = (obj as luaparse.FunctionDeclaration).identifier as luaparse.MemberExpression;
                let funcName:string =  memberExpression.identifier.name;
                for(let config of this.configs)
                {
                    for(let overrideFuncName of config.overrideFunc)
                    {
                        if(funcName ===overrideFuncName)
                        {
                 
                            this.checkFuncBody(obj,funcName,doc);
                        
                        }
                    }
                }
            }
        }
    }

    private checkFuncBody(functionDecl:luaparse.FunctionDeclaration,checkFuncName:string,doc:vscode.TextDocument):void {

        let className = ((functionDecl.identifier as luaparse.MemberExpression).base as luaparse.Identifier).name;
        let hasError:boolean = false ;
        let hasCheck:boolean = false;
        //检查 写了父类,但是写法不正确的情况
        for (let body of functionDecl.body) {
            if(body.type === 'CallStatement' && (body.expression as luaparse.CallExpression).base.type === 'MemberExpression'
            && ((body.expression as luaparse.CallExpression).base as luaparse.MemberExpression).identifier.name === checkFuncName)
            {
                hasCheck = true;
                let callexpression = body.expression as luaparse.CallExpression;
                let nemberExpression = callexpression.base as luaparse.MemberExpression;
                let callerName = ((nemberExpression.base as luaparse.MemberExpression).base as luaparse.Identifier).name;
                let midName = ((nemberExpression.base as luaparse.MemberExpression).identifier as luaparse.Identifier).name;
                let sign = nemberExpression.indexer;
                let params = callexpression.arguments as luaparse.Expression[];
                
                let oriExpression = callerName+'.'+midName+sign+checkFuncName;
                if(callerName !== className || midName!== 'super' || sign !== '.'||params.length===0)
                {
                    this.pushErrorInfo(doc,oriExpression,"请改成"+className+".super."+checkFuncName+"(self)");
                    hasError = true;
                    break;
                }
                if(params.length>0)
                {
                    let firstParam = (params[0] as luaparse.Identifier).name;
                    if(firstParam!=='self')
                    {
                        
                        this.pushErrorInfo(doc,oriExpression,"请改成"+className+".super."+checkFuncName+"(self)");
                        hasError = true;
                        break;
                    }
                }
            }
        }

        //检查没有写调用父类函数
        if(!hasCheck)
        {
            let oriExpression = className+':'+checkFuncName;
            this.pushErrorInfo(doc,oriExpression,"请增加"+className+".super."+checkFuncName+"(self)");
            hasError = true;
            
        }
       

        if(hasError===false)
        {
            //清空当前
            // this.clearErrorInfo(doc);
        }
    }



    private isContainSuperClass(body:luaparse.Statement[]):boolean {
        if(this.configs.length === 0) {return false;}
        // console.log(body);
        let isCheck = false;
        for (let obj of body) {
            if(isCheck){break;}
            if(obj.type !== 'LocalStatement'){continue;}
            let localStatement:luaparse.LocalStatement = obj as luaparse.LocalStatement;
            for(let child of localStatement.init)
            {
                if(isCheck){break;}
                let callExpression:luaparse.CallExpression = child as luaparse.CallExpression;
                if(callExpression.type === 'CallExpression' && (callExpression.base as luaparse.Identifier).name ==='class')
                {
                    let args: luaparse.CallExpression[] = callExpression.arguments as luaparse.CallExpression[];
                    if(args.length===0){continue;}
                    
                    //仅支持单继承检测
                    let superClass:luaparse.CallExpression = args[1] as luaparse.CallExpression;
                    if(superClass.type==='CallExpression'&& ((superClass.base as luaparse.Identifier).name==='require' || (superClass.base as luaparse.Identifier).name==='import'))
                    {
                        let requireArgs:luaparse.Expression[] = superClass.arguments as luaparse.Expression[];
                        if(requireArgs.length>0)
                        {
                            let firstArg:luaparse.StringLiteral = requireArgs[0] as luaparse.StringLiteral;
                            // console.log(firstArg);
                            for(let config of this.configs)
                            {
                                if(firstArg.raw.indexOf(config.name)!==-1)
                                {
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


export function registerCheckLua(context: vscode.ExtensionContext):void {

    const collection:vscode.DiagnosticCollection = vscode.languages.createDiagnosticCollection('pyluacheck');
   
    context.subscriptions.push(collection);
    new PyLuaCheck(collection);
    // context.subscriptions.push(vscode.workspace.onDidChangeTextDocument((event)=>{
    //     PyLuaCheck.instance.startCheck(event.document);
    // }));
    context.subscriptions.push(vscode.workspace.onDidSaveTextDocument(event=>{
        PyLuaCheck.instance.startCheck(event);
    }));

    context.subscriptions.push(vscode.workspace.onDidOpenTextDocument(event => {
        
        PyLuaCheck.instance.startCheck(event);
    }));
    context.subscriptions.push(vscode.workspace.onDidCloseTextDocument(event => {
        PyLuaCheck.instance.startCheck(event);
    }));
    context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(event => {
        
        PyLuaCheck.instance.startCheck(event?.document);
    }));

};
