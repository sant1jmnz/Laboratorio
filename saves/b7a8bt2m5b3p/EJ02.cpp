#include <iostream>
#include <string>
#include <fstream>
#include <cstring>

usando el espacio de nombres std;

entero sumador=1;

void Muestra(int s){
cout<<"El resultado del factorial es: ";
cout<<s;
}

int calcularFactorial(int n){

si (n == 1) {
Muestra(sumador);
} demás {
sumador = sumador * n;
calcularFactorial(n-1);
}
devolver sumador;
}

int main(){

entero numero=0;

cout<<"---Bienvenido al programa para calcular el factorial---"<<endl;
cout<<"\nIngrese el numero: ";
cin>>numero;
calcularFactorial(numero);

devolver 0;
}