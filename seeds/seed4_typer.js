// 种子4：TurboFan typer 失配模式 —— Math 函数热路径 + valueOf 返回越界值
// 对应历史漏洞特征：typer 对 Math 返回值范围推断过窄，越界后类型混淆
// （CVE-2018-17463 / CVE-2020-16040 类 simplification 阶段缺陷）
function calc(x) {
    return Math.abs(x) + 1;
}
for (var i = 0; i < 30000; i++) calc(i);
// 训练期推断 Math.abs(x) 为非负 Smi；运行时注入越界副作用值
var evil = { valueOf: function () { return -2147483648; } };
for (var j = 0; j < 100; j++) calc(evil);
console.log(calc(1));
