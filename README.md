## 本插件用来检查使用继承的lua对象,没有调用父类函数导致项目出错的问题的
```lua
local foo = class("foo",require("base"))

function foo:ctor()
    foo.super.ctor(self) --如果没有写这个,会提示错误
end
```

### pyluacheck.checkClass 配置检查继承不同的类,需要检查的函数
