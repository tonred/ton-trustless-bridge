export function intToIP(int: number) {
    let part1 = int & 255;
    let part2 = (int >> 8) & 255;
    let part3 = (int >> 16) & 255;
    let part4 = (int >> 24) & 255;

    return part4 + '.' + part3 + '.' + part2 + '.' + part1;
}
