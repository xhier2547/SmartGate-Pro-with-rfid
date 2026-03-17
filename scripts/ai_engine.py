import sqlite3
import pandas as pd
import numpy as np
from sklearn.cluster import KMeans
import json
import os
import requests

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_PATH = os.path.join(BASE_DIR, 'database', 'school.db')
DATA_PATH = os.path.join(BASE_DIR, 'data', 'ai_insights.json')

def run_ai():
    try:
        conn = sqlite3.connect(DB_PATH)
        query = """
            SELECT a.date, a.time, a.status, a.type, a.epc_code, s.name 
            FROM attendance a 
            JOIN students s ON a.epc_code = s.epc_code
        """
        df = pd.read_sql_query(query, conn)
        conn.close()
    except Exception as e:
        print(f"❌ Error loading database: {e}")
        return

    # กรองเอาเฉพาะข้อมูล "เข้า" สำหรับการวิเคราะห์พฤติกรรมความเสี่ยง
    df = df[df['type'] == 'เข้า'].copy()

    if len(df) < 10: 
        print("⚠️ ข้อมูลน้อยเกินไปสำหรับการวิเคราะห์ AI (ต้องการอย่างน้อย 10 รายการ)")
        return

    try:
        url = "https://api.open-meteo.com/v1/forecast?latitude=7.0086&longitude=100.4980&current_weather=true"
        w_res = requests.get(url, timeout=5).json()
        temp = w_res['current_weather']['temperature']
        w_code = w_res['current_weather']['weathercode']
        is_raining = w_code in [51, 53, 55, 61, 63, 65, 80, 81, 82, 95, 96, 99]
        weather_desc = f"ฝนตก ({temp}°C)" if is_raining else f"แจ่มใส ({temp}°C)"
    except Exception as e:
        is_raining = False
        weather_desc = "ไม่สามารถดึงข้อมูลอากาศได้"

    df['time_mins'] = pd.to_timedelta(df['time'] + ':00').dt.total_seconds() / 60
    latest_date = df['date'].max()
    insights = {}

    means = df.groupby('epc_code')['time_mins'].transform('mean')
    stds = df.groupby('epc_code')['time_mins'].transform('std').fillna(0)
    df['is_anomaly'] = np.abs(df['time_mins'] - means) > (2 * stds)
    anomalies = df[(df['is_anomaly']) & (df['date'] == latest_date)]['name'].unique().tolist()
    insights['anomaly_detection'] = anomalies

    user_stats = df.groupby('name')['time_mins'].mean().reset_index()
    
    if len(user_stats) >= 3:
        kmeans = KMeans(n_clusters=3, random_state=42, n_init=10)
        user_stats['cluster'] = kmeans.fit_predict(user_stats[['time_mins']])
        cluster_order = user_stats.groupby('cluster')['time_mins'].mean().sort_values().index
        
        insights['clusters'] = {
            "Early Birds": {
                "count": int((user_stats['cluster'] == cluster_order[0]).sum()), 
                "names": user_stats[user_stats['cluster'] == cluster_order[0]]['name'].tolist()
            },
            "Normal": {
                "count": int((user_stats['cluster'] == cluster_order[1]).sum()), 
                "names": user_stats[user_stats['cluster'] == cluster_order[1]]['name'].tolist()
            },
            "Risk Group": {
                "count": int((user_stats['cluster'] == cluster_order[2]).sum()), 
                "names": user_stats[user_stats['cluster'] == cluster_order[2]]['name'].tolist()
            }
        }
    else:
        insights['clusters'] = {}

    rain_victims = []
    if is_raining:
        borderline_users = user_stats[(user_stats['time_mins'] >= 465) & (user_stats['time_mins'] <= 480)]['name'].tolist()
        rain_victims = borderline_users

    insights['weather_impact'] = {
        "is_raining": is_raining,
        "victims": rain_victims
    }

    late_df = df[df['status'] == 'สาย']
    late_trend = late_df.groupby('date').size()
    
    if len(late_trend) > 1 and late_trend.iloc[-1] > late_trend.iloc[-2]:
        trend_status = "เพิ่มขึ้น 📈"
    else:
        trend_status = "ลดลง 📉"
        
    today_lates = len(df[(df['date'] == latest_date) & (df['status'] == 'สาย')])
    weather_impact_text = f"⚠️ ฝนตก คาดว่าจะมีกลุ่มเสี่ยงมาสายเพิ่มขึ้น {len(rain_victims)} คน" if is_raining else "☀️ อากาศปกติ"

    insights['auto_summary'] = f"รายงานวันที่ {latest_date}: สภาพอากาศ ม.อ. {weather_desc} | วันนี้มีนักเรียนมาสาย {today_lates} คน (แนวโน้ม{trend_status}) | {weather_impact_text}"

    try:
        with open(DATA_PATH, 'w', encoding='utf-8') as f:
            json.dump(insights, f, ensure_ascii=False, indent=4)
        print(f"AI Analysis Completed!")
    except Exception as e:
        print(f"Error saving insights: {e}")

if __name__ == "__main__":
    run_ai()