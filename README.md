## 本插件用来检查使用继承的lua对象,检查重写父类函数,没有调用父类函数问题

*只会检查class命名*
```lua
local foo = class("foo",require("base"))

function foo:ctor()
    foo.super.ctor(self) --如果没有写这个,会提示错误
end
```

### pyluacheck.checkClass 配置检查继承不同的类,需要检查的函数

* name要写你要检查的基类的全lua路径 *
```json
"pyluacheck.checkClass": [
    {
        "name":"Base",
        "overrideFunc":[
            "Ctor","Destroy"
        ]
    },
    {
        "name":"UI.BaseUI",  
        "overrideFunc":[
            "Ctor","Close"
        ]
    },
]
```
---
[项目源码](https://github.com/firleaves/PyLuaCheck.git)

### 依赖项目(已经包含插件内):
### [luaparse](https://github.com/fstirlitz/luaparse)
