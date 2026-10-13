// 种子8：堆内存耗尽模式 —— 大数组高速填充突破 V8 堆上限
// 对应历史漏洞特征：内存分配失控导致引擎致命错误（资源耗尽型 DoS）
// 预期结果：崩溃（crash）——进程被 V8 OOM 终止，验证崩溃捕获链路
var sink = [];
for (var i = 0; i < 1e9; i++) {
    sink.push(new Array(10000000).fill(1.1));  // 每次约 80MB，迅速突破堆上限
}
console.log(sink.length);
