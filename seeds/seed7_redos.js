// 种子7：正则灾难性回溯模式 —— 嵌套量词 + 必然失败的匹配
// 对应历史漏洞特征：正则引擎指数级回溯导致拒绝服务（ReDoS，CVE-2021-228xx 类）
// 预期结果：超时（timeout）——验证引擎的异常用例监控链路
var re = /^(a+)+$/;
var s = "a".repeat(40) + "!";   // 永不匹配，回溯次数随长度指数爆炸
var ok = false;
for (var i = 0; i < 30000; i++) {
    ok = re.test(s);
}
console.log(ok);
