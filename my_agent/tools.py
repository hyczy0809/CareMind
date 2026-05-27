from datetime import datetime
from zoneinfo import ZoneInfo
import requests
import re
import os
from dotenv import load_dotenv

load_dotenv()

CHINA = ZoneInfo("Asia/Shanghai")

def get_time_in_china():
    """Return current time in China Standard Time (UTC+8)."""
    now = datetime.now(tz=CHINA)
    return now.strftime("%Y-%m-%d %H:%M:%S CST")

def get_shanghai_composite_index():
    """
    获取上证指数 (SSE Composite Index) 的最新数据。
    """
    # 新浪财经的实时接口
    url = "http://hq.sinajs.cn/list=s_sh000001"
    # 必须加上 Referer，否则会被新浪封禁；同时模拟浏览器头
    headers = {
        "Referer": "http://finance.sina.com.cn",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
    }
    
    try:
        # 使用 requests 获取数据
        response = requests.get(url, headers=headers, timeout=10)
        
        # 新浪接口返回的是 GBK 编码，需要手动解码防止中文乱码
        content = response.content.decode('gbk')
        
        # 格式示例: var hq_str_s_sh000001="上证指数,3052.45,13.20,0.43,123456,789012";
        match = re.search(r'"([^"]*)"', content)
        if match:
            data_str = match.group(1)
            if not data_str:
                return "当前非交易时间或接口无数据。"
            
            parts = data_str.split(',')
            # 指数名称, 当前点数, 涨跌额, 涨跌幅, 成交量(手), 成交额(万元)
            name = parts[0]
            current_point = parts[1]
            change_value = parts[2]
            change_percent = parts[3]
            
            # 格式化输出
            symbol = "📈" if float(change_value) >= 0 else "📉"
            return f"{symbol} {name}: {current_point} | 涨跌: {change_value} ({change_percent}%)"
        
        return "未能解析到指数数据，请检查网络。"
    except Exception as e:
        return f"获取上证指数失败，原因: {str(e)}"

# 将所有工具汇总到一个列表
ALL_TOOLS = [
    get_time_in_china,
    get_shanghai_composite_index
]


