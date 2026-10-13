// 种子1：JIT 类型混淆模式 —— 热循环内联 + valueOf 副作用改变类型
// 对应历史漏洞特征：Turbofan 类型推断失配（CVE-2020-6418 类）
function opt(a) {
    return a.x + 1;
}
var obj1 = { x: 1 };
for (var i = 0; i < 30000; i++) opt(obj1);
var obj2 = { x: 2, valueOf: function () { return 3; } };
for (var j = 0; j < 100; j++) opt(obj2);
console.log(opt(obj1));
